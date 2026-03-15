from pydantic import BaseModel


class DiffResponse(BaseModel):
    has_changes: bool
    diff_html: str
    baseline_version: int
    current_version: int
