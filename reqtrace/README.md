# ReqTrace

Инструмент визуальной трассировки покрытия требований тестами для QA-команд.

## Возможности

- Загрузка страниц требований из Confluence Server
- Посимвольное выделение фрагментов текста и привязка тест-кейсов из Jira/XRay
- Отслеживание изменений в требованиях с визуальным diff
- Проекция выделений при обновлении страниц (active / outdated / lost)
- Система baseline для фиксации актуальной версии требований
- Многопользовательский доступ с общим рабочим пространством

## Стек

| Компонент | Технология |
|---|---|
| Frontend | React + TypeScript |
| Backend | Python + FastAPI |
| БД | PostgreSQL 16 |
| Развёртывание | Docker Compose |

## Быстрый старт

### 1. Настройте переменные окружения

```bash
cp .env.example .env
```

Отредактируйте `.env`, указав данные подключения к Confluence и Jira:

```
CONFLUENCE_BASE_URL=https://confluence.example.com
CONFLUENCE_USERNAME=your_username
CONFLUENCE_PASSWORD=your_password
JIRA_BASE_URL=https://jira.example.com
```

### 2. Запустите через Docker Compose

```bash
docker-compose up -d
```

Сервисы:
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:8000
- **PostgreSQL:** localhost:5432

### 3. Откройте приложение

Перейдите по адресу http://localhost:3000. Введите ваше имя для входа.

## Разработка

### Backend (без Docker)

```bash
cd backend
pip install -r requirements.txt
# Убедитесь, что PostgreSQL запущен
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### Frontend (без Docker)

```bash
cd frontend
npm install
REACT_APP_API_URL=http://localhost:8000/api npm start
```

## API

| Метод | Endpoint | Описание |
|---|---|---|
| POST | `/api/users` | Создание/вход пользователя |
| GET | `/api/users` | Список пользователей |
| POST | `/api/pages` | Добавление страницы Confluence |
| GET | `/api/pages` | Список отслеживаемых страниц |
| GET | `/api/pages/{id}` | Детали страницы |
| POST | `/api/pages/{id}/refresh` | Обновление из Confluence |
| POST | `/api/pages/{id}/baseline` | Установка baseline |
| POST | `/api/pages/{id}/highlights` | Создание выделения |
| GET | `/api/pages/{id}/highlights` | Выделения страницы |
| DELETE | `/api/highlights/{id}` | Удаление выделения |
| POST | `/api/highlights/{id}/tests` | Привязка теста |
| DELETE | `/api/highlight-tests/{id}` | Отвязка теста |
| GET | `/api/pages/{id}/diff` | Diff baseline vs текущий снимок |

## Архитектура

```
Frontend (React, :3000) → Backend (FastAPI, :8000) → PostgreSQL (:5432)
                                    ↓
                          Confluence Server API
```
