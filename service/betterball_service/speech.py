"""Azure AI Speech text-to-speech for the AI Pundit, with Microsoft Entra ID (no keys).

Uses the Speech service of the Foundry (AI Services) resource. The caller's identity needs the
"Cognitive Services Speech User" role on that resource. Configure with:

    SPEECH_REGION=northcentralus
    SPEECH_RESOURCE_ID=/subscriptions/.../providers/Microsoft.CognitiveServices/accounts/<name>
"""

from __future__ import annotations

import logging
import os
from xml.sax.saxutils import escape

import httpx

from .identity import async_credential

log = logging.getLogger("betterball")

# Neural voices per language; English gets a different voice for the analyst audience.
VOICES = {
    "English": ("en-GB", "en-GB-RyanNeural", "en-GB-ThomasNeural"),
    "Spanish": ("es-ES", "es-ES-AlvaroNeural", "es-ES-AlvaroNeural"),
    "French": ("fr-FR", "fr-FR-HenriNeural", "fr-FR-HenriNeural"),
    "Portuguese": ("pt-BR", "pt-BR-AntonioNeural", "pt-BR-AntonioNeural"),
    "German": ("de-DE", "de-DE-ConradNeural", "de-DE-ConradNeural"),
    "Hindi": ("hi-IN", "hi-IN-MadhurNeural", "hi-IN-MadhurNeural"),
    "Arabic": ("ar-SA", "ar-SA-HamedNeural", "ar-SA-HamedNeural"),
    "Japanese": ("ja-JP", "ja-JP-KeitaNeural", "ja-JP-KeitaNeural"),
}


def configured() -> bool:
    return bool(os.environ.get("SPEECH_REGION") and os.environ.get("SPEECH_RESOURCE_ID"))


def voice_for(language: str, audience: str) -> tuple[str, str]:
    lang, fan, analyst = VOICES.get(language, VOICES["English"])
    return lang, analyst if audience == "analyst" else fan


def ssml(lines: list[str], language: str, audience: str) -> str:
    lang, voice = voice_for(language, audience)
    rate = "+6%" if audience == "fan" else "0%"
    body = "<break time='350ms'/>".join(escape(line) for line in lines)
    return (
        f"<speak version='1.0' xml:lang='{lang}'><voice name='{voice}'>"
        f"<prosody rate='{rate}'>{body}</prosody></voice></speak>"
    )


async def synthesize(lines: list[str], language: str, audience: str) -> bytes | None:
    """MP3 audio of the pundit's lines, or None if Speech is not configured or fails."""
    if not configured() or not lines:
        return None
    try:
        token = (await async_credential().get_token("https://cognitiveservices.azure.com/.default")).token
        region = os.environ["SPEECH_REGION"]
        resource = os.environ["SPEECH_RESOURCE_ID"]
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(
                f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
                headers={
                    "Authorization": f"Bearer aad#{resource}#{token}",
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
                    "User-Agent": "the-better-ball",
                },
                content=ssml(lines, language, audience).encode("utf-8"),
            )
        if r.status_code != 200:
            log.warning("speech synthesis failed: %s %s", r.status_code, r.text[:200])
            return None
        return r.content
    except Exception:  # noqa: BLE001 - commentary audio is optional; captions still work
        log.warning("speech synthesis error", exc_info=True)
        return None
