from pydantic import BaseModel


class SettingsUpdate(BaseModel):
    confluence_base_url: str = ""
    confluence_username: str = ""
    confluence_password: str = ""
    jira_base_url: str = ""


class SettingsResponse(BaseModel):
    confluence_base_url: str = ""
    confluence_username: str = ""
    confluence_password_set: bool = False
    jira_base_url: str = ""
