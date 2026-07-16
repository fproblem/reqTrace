"""Планировщик ночного прогона (v1.6.2, план — auto-refresh-plan-v1.6.md).

Фоновая asyncio-задача (lifespan main.py): раз в минуту решает «пора?» по
ЖУРНАЛУ (refresh_runs), а не по таймеру в памяти — рестарт контейнера не
теряет и не дублирует прогон, а пропущенная ночь навёрстывается при старте.
Advisory-lock Postgres страхует от двойного запуска (dev --reload, второй
инстанс). Принятое ограничение: процесс, умерший посреди обхода, не повторит
обход в тот же день — оставшиеся проекты подхватит следующая ночь (или
ручной запуск python -m app.jobs.nightly).
"""
import asyncio
import logging
from datetime import datetime, time as dtime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text

from app.config import settings
from app.database import async_session, engine
from app.jobs.nightly import pick_retry_projects, run_project, run_projects, run_sweep
from app.models.project import Project
from app.models.refresh_run import RefreshRun

logger = logging.getLogger(__name__)

TICK_SECONDS = 60
# Ключ advisory-lock прогона — произвольная константа, общая для всех инстансов.
ADVISORY_LOCK_KEY = 931_337_101
# Самолечение (v1.6.4): как часто добирать проекты без успешного прогона.
RETRY_AFTER_MINUTES = 60


def parse_hhmm(value: str) -> dtime:
    """«03:00» → time. Мусор в конфиге не должен убивать планировщик."""
    try:
        hh, mm = value.strip().split(":")
        return dtime(int(hh), int(mm))
    except Exception:
        logger.error("auto-refresh: AUTO_REFRESH_AT=%r не разобрано, использую 03:00", value)
        return dtime(3, 0)


def _zone(tz_name: str):
    try:
        return ZoneInfo(tz_name)
    except Exception:
        logger.error("auto-refresh: неизвестная таймзона %r, использую UTC", tz_name)
        return timezone.utc


def is_run_due(
    now_utc: datetime, *, at: str, tz_name: str, last_start_utc: datetime | None
) -> bool:
    """Пора ли запускать прогон.

    Да, если локальное время (в зоне tz_name) достигло `at`, а за сегодняшний
    ЛОКАЛЬНЫЙ день auto-прогон ещё не стартовал (по журналу). Прогон, начатый
    вчера до полуночи, сегодняшнему не мешает.
    """
    tz = _zone(tz_name)
    local_now = now_utc.astimezone(tz)
    if local_now.time() < parse_hhmm(at):
        return False
    if last_start_utc is None:
        return True
    return last_start_utc.astimezone(tz).date() < local_now.date()


async def _last_auto_start() -> datetime | None:
    async with async_session() as db:
        result = await db.execute(
            select(func.max(RefreshRun.started_at)).where(RefreshRun.trigger == "auto")
        )
        return result.scalar()


async def _run_locked(runner) -> bool:
    """Выполнить runner под session-level advisory-lock; False — лок занят.

    Лок держится на отдельном соединении всё время работы (при смерти
    процесса Postgres снимет его сам); pg_advisory_xact_lock не подходит —
    прогон коммитит много раз. Лок общий для всех видов прогонов: ночной,
    добор и ручной никогда не идут одновременно.
    """
    async with engine.connect() as conn:
        got = (await conn.execute(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": ADVISORY_LOCK_KEY}
        )).scalar()
        await conn.commit()  # закрыть транзакцию: session-lock живёт вне её
        if not got:
            logger.info("auto-refresh: лок занят — прогон уже идёт")
            return False
        try:
            await runner()
        finally:
            await conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": ADVISORY_LOCK_KEY})
            await conn.commit()
    return True


async def run_sweep_locked(*, trigger: str) -> bool:
    return await _run_locked(lambda: run_sweep(trigger=trigger))


async def _retry_candidates(now_utc: datetime) -> list:
    """Проекты для самолечебного добора: попытки за сегодняшний ЛОКАЛЬНЫЙ день
    были, успешной нет, последняя — старше RETRY_AFTER_MINUTES."""
    tz = _zone(settings.AUTO_REFRESH_TZ)
    local_now = now_utc.astimezone(tz)
    day_start = datetime.combine(local_now.date(), dtime(0, 0), tzinfo=tz).astimezone(timezone.utc)
    async with async_session() as db:
        rows = (await db.execute(
            select(
                RefreshRun.project_id, RefreshRun.status,
                RefreshRun.started_at, RefreshRun.finished_at,
            ).where(RefreshRun.started_at >= day_start)
        )).all()
    return pick_retry_projects(rows, now_utc, RETRY_AFTER_MINUTES)


# Фоновые задачи ручных прогонов: create_task держит только слабую ссылку —
# без своей коллекции задачу мог бы собрать GC на середине прогона.
_MANUAL_TASKS: set = set()


async def start_manual_run(project_id, *, prefer_user_id) -> bool:
    """Ручной прогон одного проекта (v1.6.4, кнопка «Обновить страницы сейчас»).

    Запускается фоном — HTTP-запрос не ждёт минуты прогона; лок берётся до
    ответа, чтобы честно вернуть False («уже идёт») вместо тихой очереди.
    Прогон идёт кредами инициатора в первую очередь (он дал согласие кликом).
    """
    conn = await engine.connect()
    got = (await conn.execute(
        text("SELECT pg_try_advisory_lock(:key)"), {"key": ADVISORY_LOCK_KEY}
    )).scalar()
    await conn.commit()
    if not got:
        await conn.close()
        return False

    async def _run() -> None:
        try:
            async with async_session() as db:
                project = await db.get(Project, project_id)
            if project is not None and not project.is_demo:
                await run_project(
                    async_session, project, trigger="manual", prefer_user_id=prefer_user_id
                )
        except Exception:
            logger.exception("manual-run: прогон проекта %s упал", project_id)
        finally:
            try:
                await conn.execute(
                    text("SELECT pg_advisory_unlock(:key)"), {"key": ADVISORY_LOCK_KEY}
                )
                await conn.commit()
            finally:
                await conn.close()

    task = asyncio.create_task(_run())
    _MANUAL_TASKS.add(task)
    task.add_done_callback(_MANUAL_TASKS.discard)
    return True


async def auto_refresh_loop() -> None:
    """Вечный цикл планировщика; живёт как asyncio-задача в lifespan.

    Первое действие — sleep: приложение успевает подняться, а юнит-тесты с
    TestClient не трогают БД. Ошибка тика логируется и не убивает цикл.
    """
    # In-memory страховка на день без проектов: он не оставляет строк журнала,
    # и без отметки цикл дёргал бы пустой прогон каждый тик.
    last_sweep_date = None
    logger.info(
        "auto-refresh: планировщик запущен (%s, %s)",
        settings.AUTO_REFRESH_AT, settings.AUTO_REFRESH_TZ,
    )
    while True:
        await asyncio.sleep(TICK_SECONDS)
        try:
            now = datetime.now(timezone.utc)
            today_local = now.astimezone(_zone(settings.AUTO_REFRESH_TZ)).date()

            # 1) Основной суточный прогон по расписанию.
            if last_sweep_date != today_local and is_run_due(
                now,
                at=settings.AUTO_REFRESH_AT,
                tz_name=settings.AUTO_REFRESH_TZ,
                last_start_utc=await _last_auto_start(),
            ):
                logger.info("auto-refresh: старт ночного прогона")
                await run_sweep_locked(trigger="auto")
                last_sweep_date = today_local

            # 2) Самолечение (v1.6.4): Confluence мог быть недоступен в 03:00
            # (например, выключен VPN на машине с бэкендом) — раз в час
            # добираем проекты, оставшиеся без успешного прогона за сегодня.
            # Дайджест приедет сам, как только связь появится.
            retry_ids = await _retry_candidates(now)
            if retry_ids:
                logger.info("auto-refresh: самолечебный добор %d проектов", len(retry_ids))
                await _run_locked(lambda: run_projects(retry_ids, trigger="retry"))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("auto-refresh: тик планировщика упал — продолжаю")
