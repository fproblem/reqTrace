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
from app.jobs.nightly import run_sweep
from app.models.refresh_run import RefreshRun

logger = logging.getLogger(__name__)

TICK_SECONDS = 60
# Ключ advisory-lock прогона — произвольная константа, общая для всех инстансов.
ADVISORY_LOCK_KEY = 931_337_101


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


async def run_sweep_locked(*, trigger: str) -> bool:
    """Прогон под session-level advisory-lock; False — лок занят другим процессом.

    Лок держится на отдельном соединении всё время обхода (при смерти
    процесса Postgres снимет его сам); pg_advisory_xact_lock не подходит —
    прогон коммитит много раз.
    """
    async with engine.connect() as conn:
        got = (await conn.execute(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": ADVISORY_LOCK_KEY}
        )).scalar()
        await conn.commit()  # закрыть транзакцию: session-lock живёт вне её
        if not got:
            logger.info("auto-refresh: лок занят — прогон уже идёт в другом процессе")
            return False
        try:
            await run_sweep(trigger=trigger)
        finally:
            await conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": ADVISORY_LOCK_KEY})
            await conn.commit()
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
            if last_sweep_date == today_local:
                continue
            if not is_run_due(
                now,
                at=settings.AUTO_REFRESH_AT,
                tz_name=settings.AUTO_REFRESH_TZ,
                last_start_utc=await _last_auto_start(),
            ):
                continue
            logger.info("auto-refresh: старт ночного прогона")
            await run_sweep_locked(trigger="auto")
            last_sweep_date = today_local
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("auto-refresh: тик планировщика упал — продолжаю")
