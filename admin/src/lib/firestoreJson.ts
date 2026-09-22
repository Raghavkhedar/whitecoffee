// Whole-document JSON editing for the /superadmin page (docs/superpowers/specs/
// 2026-09-22-superadmin-portal-editor-design.md). Recursively converts Firestore
// Timestamp values to/from a { __timestamp__: "<ISO>" } marker so an entire document —
// including Timestamps nested inside arrays/maps, e.g. suspensionHistory[].at — can be
// shown and edited as one plain JSON blob.
//
// Known limitation, accepted: GeoPoint and DocumentReference values do NOT round-trip
// through this format. Nothing in this schema currently uses either type (coordinates
// are plain latitude/longitude numbers throughout), so this is a documented
// simplification, not a silent gap.
import { Timestamp } from 'firebase/firestore';

const TIMESTAMP_MARKER = '__timestamp__';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function toEditable(value: unknown): JsonValue {
  if (value instanceof Timestamp) {
    return { [TIMESTAMP_MARKER]: value.toDate().toISOString() };
  }
  if (Array.isArray(value)) {
    return value.map(toEditable);
  }
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toEditable(v);
    }
    return out;
  }
  // string | number | boolean | null pass through unchanged.
  return value as JsonValue;
}

export function docToEditableJson(data: Record<string, unknown>): string {
  return JSON.stringify(toEditable(data), null, 2);
}

function isTimestampMarker(value: unknown): value is { [TIMESTAMP_MARKER]: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 1 &&
    typeof (value as Record<string, unknown>)[TIMESTAMP_MARKER] === 'string'
  );
}

function fromEditable(value: JsonValue): unknown {
  if (isTimestampMarker(value)) {
    const iso = (value as unknown as Record<string, string>)[TIMESTAMP_MARKER];
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid __timestamp__ value: ${JSON.stringify(iso)}`);
    }
    return Timestamp.fromDate(date);
  }
  if (Array.isArray(value)) {
    return value.map(fromEditable);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = fromEditable(v as JsonValue);
    }
    return out;
  }
  return value;
}

export function editableJsonToDoc(json: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Document must be a JSON object, not an array or a primitive.');
  }
  return fromEditable(parsed as JsonValue) as Record<string, unknown>;
}
