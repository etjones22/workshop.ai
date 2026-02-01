import argparse
import json
import sys
import wave

from vosk import Model, KaldiRecognizer


def transcribe(model_path: str, input_path: str) -> str:
    wf = wave.open(input_path, "rb")
    if wf.getnchannels() != 1:
        raise RuntimeError("Audio must be mono")

    model = Model(model_path)
    rec = KaldiRecognizer(model, wf.getframerate())
    rec.SetWords(False)

    parts = []
    while True:
        data = wf.readframes(4000)
        if len(data) == 0:
            break
        if rec.AcceptWaveform(data):
            res = json.loads(rec.Result())
            text = res.get("text", "").strip()
            if text:
                parts.append(text)

    res = json.loads(rec.FinalResult())
    text = res.get("text", "").strip()
    if text:
        parts.append(text)

    return " ".join(parts).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--input", required=True)
    args = parser.parse_args()

    try:
        text = transcribe(args.model, args.input)
        sys.stdout.write(text)
        return 0
    except Exception as exc:
        sys.stderr.write(str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
