from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field


app = FastAPI(title="Reno SignalStack NLP", version="0.1.0")


class TranscriptRequest(BaseModel):
    source_type: Literal["atc", "scanner"] = Field(
        description="Audio domain for cleanup rules"
    )
    raw_text: str
    channel: str


class ExtractedEntity(BaseModel):
    kind: str
    value: str
    confidence: float


class TranscriptResponse(BaseModel):
    raw_text: str
    clean_text: str
    summary: str
    entities: list[ExtractedEntity]
    model_confidence: float
    rule_confidence: float
    generated_at: str


ATC_HINTS = {
    "runway": "17R",
    "callsign": "SWA4437",
    "frequency": "118.700",
}

SCANNER_HINTS = {
    "unit": "Engine 6",
    "incident_type": "vehicle fire",
    "location": "I-80 and Vista",
}


def generate_clean_text(source_type: str, raw_text: str) -> str:
    if source_type == "atc":
        return raw_text.replace("runway one seven right", "runway 17R").capitalize()
    return raw_text.replace("eighty", "I-80").capitalize()


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "nlp",
        "now": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/transcribe/mock", response_model=TranscriptResponse)
def transcribe_mock(request: TranscriptRequest) -> TranscriptResponse:
    clean_text = generate_clean_text(request.source_type, request.raw_text)

    if request.source_type == "atc":
        entities = [
            ExtractedEntity(kind="callsign", value=ATC_HINTS["callsign"], confidence=0.92),
            ExtractedEntity(kind="runway", value=ATC_HINTS["runway"], confidence=0.89),
            ExtractedEntity(kind="frequency", value=ATC_HINTS["frequency"], confidence=0.98),
        ]
        summary = "Controller appears to issue an approach or runway-related instruction."
    else:
        entities = [
            ExtractedEntity(kind="unit", value=SCANNER_HINTS["unit"], confidence=0.84),
            ExtractedEntity(
                kind="incident_type",
                value=SCANNER_HINTS["incident_type"],
                confidence=0.77,
            ),
            ExtractedEntity(kind="location", value=SCANNER_HINTS["location"], confidence=0.61),
        ]
        summary = "Dispatch traffic likely references a vehicle fire near the Vista corridor."

    return TranscriptResponse(
        raw_text=request.raw_text,
        clean_text=clean_text,
        summary=summary,
        entities=entities,
        model_confidence=0.79,
        rule_confidence=0.88,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
