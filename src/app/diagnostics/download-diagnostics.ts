import type {
  DownloadableDuelDiagnostics,
  DuelDiagnosticTrace,
} from "../../duel/contracts/duel-diagnostics.ts";
import type { SnapshotId } from "../../duel/contracts/ids.ts";

export interface DiagnosticEnvironment {
  readonly buildId: string;
  readonly userAgent: string;
  readonly language: string;
  readonly activeSnapshotId?: SnapshotId | null;
  readonly fallbackSnapshotId?: SnapshotId | null;
  readonly imageCache: DownloadableDuelDiagnostics["application"]["imageCache"];
  readonly now?: () => Date;
}

export function buildDownloadableDiagnostics(
  trace: DuelDiagnosticTrace,
  environment: DiagnosticEnvironment,
): DownloadableDuelDiagnostics {
  return Object.freeze({
    schemaVersion: 2,
    sensitivity: "contains-production-seed",
    generatedAt: (environment.now ?? (() => new Date()))().toISOString(),
    application: Object.freeze({
      buildId: environment.buildId,
      userAgent: environment.userAgent,
      language: environment.language,
      activeSnapshotId: environment.activeSnapshotId ?? null,
      fallbackSnapshotId: environment.fallbackSnapshotId ?? null,
      imageCache: Object.freeze({ ...environment.imageCache }),
    }),
    trace,
  });
}

export function downloadDuelDiagnostics(
  trace: DuelDiagnosticTrace,
  environment: DiagnosticEnvironment,
  documentObject: Document = document,
): void {
  const diagnostics = buildDownloadableDiagnostics(trace, environment);
  const blob = new Blob([`${JSON.stringify(diagnostics, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  try {
    const link = documentObject.createElement("a");
    link.href = url;
    link.download = `ygo-duel-diagnostics-${trace.snapshotId.slice(0, 12)}.json`;
    link.rel = "noopener";
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
