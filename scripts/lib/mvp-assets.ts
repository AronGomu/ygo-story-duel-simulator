export interface MvpAssetOptions {
  help: boolean;
  offline: boolean;
  forceImages: boolean;
  concurrency?: number;
  requestsPerSecond?: number;
}

export interface AssetStage {
  name: string;
  script: string;
  args: string[];
}

export function parseMvpAssetOptions(args: string[]): MvpAssetOptions {
  const options: MvpAssetOptions = {
    help: false,
    offline: false,
    forceImages: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--offline") {
      options.offline = true;
    } else if (argument === "--force-images") {
      options.forceImages = true;
    } else if (argument === "--concurrency" || argument === "--requests-per-second") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${argument}`);
      }
      const parsed = positiveInteger(value, argument);
      if (argument === "--requests-per-second" && parsed > 20) {
        throw new Error("--requests-per-second cannot exceed 20");
      }
      if (argument === "--concurrency") {
        options.concurrency = parsed;
      } else {
        options.requestsPerSecond = parsed;
      }
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.offline && options.forceImages) {
    throw new Error("--offline and --force-images cannot be used together");
  }
  return options;
}

export function buildAssetStages(options: MvpAssetOptions): AssetStage[] {
  const imageArguments: string[] = [];
  if (options.forceImages) imageArguments.push("--force");
  if (options.concurrency !== undefined) {
    imageArguments.push("--concurrency", String(options.concurrency));
  }
  if (options.requestsPerSecond !== undefined) {
    imageArguments.push("--requests-per-second", String(options.requestsPerSecond));
  }

  return [
    {
      name: "syncDuelEngine",
      script: "sync-engine.ts",
      args: options.offline ? ["--offline"] : [],
    },
    { name: "verifyDuelEngine", script: "verify-engine.ts", args: [] },
    {
      name: "syncDataScriptsAndStrings",
      script: "sync-assets.ts",
      args: options.offline ? ["--offline"] : [],
    },
    { name: "verifyDataScriptsAndStrings", script: "verify-assets.ts", args: [] },
    ...(options.offline
      ? []
      : [{ name: "downloadCardImages", script: "download-images.ts", args: imageArguments }]),
    { name: "verifyCardImages", script: "verify-images.ts", args: [] },
    {
      name: "generateRuntimeSnapshot",
      script: "generate-runtime-snapshot.ts",
      args: [],
    },
    {
      name: "verifyRuntimeSnapshot",
      script: "verify-runtime-snapshot.ts",
      args: [],
    },
  ];
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}
