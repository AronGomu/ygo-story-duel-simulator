import Phaser from "phaser";
import type { PlayerPrompt } from "../duel/contracts/player-prompt.ts";
import type { PublicDuelState } from "../duel/contracts/public-duel-state.ts";
import type { PresentationCommand } from "../app/presentation/presentation-command.ts";
import {
  mapSnapshotToField,
  promptFieldTargets,
  type FieldCardView,
  type FieldStackView,
} from "./card-mapping.ts";
import {
  createDuelFieldLayout,
  DUEL_FIELD_HEIGHT,
  DUEL_FIELD_WIDTH,
} from "./duel-field-layout.ts";

export interface DuelSceneOptions {
  readonly onReady: () => void;
  readonly onCardIntent: (instanceId: string) => void;
  readonly onZoneIntent: (zoneId: string) => void;
}

export class DuelScene extends Phaser.Scene {
  readonly #options: DuelSceneOptions;
  readonly #cards = new Map<string, Phaser.GameObjects.Container>();
  readonly #stacks = new Map<string, Phaser.GameObjects.Container>();
  readonly #zones = new Map<string, Phaser.GameObjects.Rectangle>();
  readonly #feedback = new Set<Phaser.GameObjects.GameObject>();
  readonly #failedTextures = new Set<string>();
  #snapshot: PublicDuelState | null = null;
  #prompt: PlayerPrompt | null = null;
  #imageUrls: ReadonlyMap<number, string> = new Map();
  #cardBackUrl = "";
  #placeholderUrl = "";
  #texturesLoading = false;

  constructor(options: DuelSceneOptions) {
    super({ key: "DuelScene" });
    this.#options = options;
  }

  create(): void {
    this.load.on(
      Phaser.Loader.Events.FILE_LOAD_ERROR,
      (file: { readonly key?: string }) => {
        if (typeof file.key === "string") this.#failedTextures.add(file.key);
      },
    );
    this.cameras.main.setBackgroundColor("#08111f");
    this.add
      .rectangle(
        DUEL_FIELD_WIDTH / 2,
        DUEL_FIELD_HEIGHT / 2,
        DUEL_FIELD_WIDTH - 20,
        6,
        0xd9a441,
        0.35,
      )
      .setDepth(0);
    for (const zone of createDuelFieldLayout()) {
      const rectangle = this.add
        .rectangle(zone.x, zone.y, zone.width, zone.height, 0x142139, 0.38)
        .setStrokeStyle(2, 0x4d617f, 0.8)
        .setData("zoneId", zone.id)
        .setInteractive({ useHandCursor: true });
      rectangle.on("pointerdown", () => this.#options.onZoneIntent(zone.id));
      this.#zones.set(zone.id, rectangle);
      this.add
        .text(zone.x, zone.y + zone.height / 2 - 10, zone.label, {
          color: "#91a0b8",
          fontFamily: "system-ui, sans-serif",
          fontSize: "11px",
          align: "center",
          wordWrap: { width: zone.width + 24 },
        })
        .setOrigin(0.5, 0)
        .setDepth(1);
    }
    this.#options.onReady();
  }

  setImages(
    urls: ReadonlyMap<number, string>,
    cardBackUrl: string,
    placeholderUrl: string,
  ): void {
    this.#imageUrls = urls;
    this.#cardBackUrl = cardBackUrl;
    this.#placeholderUrl = placeholderUrl;
    if (this.sys.isActive()) this.#loadTextures();
  }

  applySnapshot(snapshot: PublicDuelState): void {
    this.#snapshot = snapshot;
    if (!this.sys.isActive()) return;
    this.#loadTextures();
    const view = mapSnapshotToField(snapshot);
    this.#reconcileCards(view.cards);
    this.#reconcileStacks(view.stacks);
    this.events.emit("field-rendered", {
      hiddenCards: [...view.cards.values()].filter(({ hidden }) => hidden)
        .length,
      faceImages: [...view.cards.values()].filter(
        ({ hidden, code }) => !hidden && code !== undefined,
      ).length,
    });
    this.applyPrompt(this.#prompt);
  }

  applyPrompt(prompt: PlayerPrompt | null): void {
    this.#prompt = prompt;
    if (!this.sys.isActive()) return;
    const targets = promptFieldTargets(prompt, this.#snapshot);
    for (const [id, card] of this.#cards) {
      const selected = targets.cardIds.has(id);
      const border = card.getByName(
        "border",
      ) as Phaser.GameObjects.Rectangle | null;
      border?.setStrokeStyle(
        selected ? 5 : 2,
        selected ? 0x48d7a4 : 0x7184a3,
        1,
      );
      card.setScale(selected ? 1.06 : 1);
    }
    for (const [id, zone] of this.#zones) {
      zone.setStrokeStyle(
        targets.zoneIds.has(id) ? 5 : 2,
        targets.zoneIds.has(id) ? 0x48d7a4 : 0x4d617f,
        0.9,
      );
    }
  }

  present(command: PresentationCommand): void {
    if (!this.sys.isActive()) return;
    const color =
      command.kind === "attack"
        ? "#ff756d"
        : command.kind === "life-points"
          ? "#ffd166"
          : "#e9f1ff";
    const text = this.add
      .text(DUEL_FIELD_WIDTH / 2, DUEL_FIELD_HEIGHT / 2, command.label, {
        color,
        backgroundColor: "#08111fee",
        fontFamily: "system-ui, sans-serif",
        fontSize: "28px",
        fontStyle: "bold",
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setDepth(100);
    this.#feedback.add(text);
    const remove = (): void => {
      this.#feedback.delete(text);
      text.destroy();
    };
    if (command.durationMs === 0) {
      this.time.delayedCall(450, remove);
      return;
    }
    this.tweens.add({
      targets: text,
      y: text.y - 36,
      alpha: 0,
      duration: command.durationMs,
      ease: "Cubic.easeOut",
      onComplete: remove,
    });
  }

  resetPresentation(): void {
    if (!this.sys.isActive()) return;
    this.tweens.killAll();
    this.#feedback.forEach((object) => object.destroy());
    this.#feedback.clear();
    this.#cards.forEach((card) => card.destroy(true));
    this.#stacks.forEach((stack) => stack.destroy(true));
    this.#cards.clear();
    this.#stacks.clear();
    this.#snapshot = null;
    this.#prompt = null;
    this.applyPrompt(null);
  }

  #reconcileCards(next: ReadonlyMap<string, FieldCardView>): void {
    for (const [id, object] of this.#cards) {
      if (next.has(id)) continue;
      object.destroy(true);
      this.#cards.delete(id);
    }
    for (const [id, view] of next) {
      let object = this.#cards.get(id);
      const signature = `${view.code ?? "hidden"}:${view.hidden}`;
      if (object === undefined) {
        object = this.#createCard(view, signature);
        this.#cards.set(id, object);
      } else if (object.getData("signature") !== signature) {
        object.destroy(true);
        object = this.#createCard(view, signature);
        this.#cards.set(id, object);
      }
      object.setPosition(view.x, view.y).setAngle(view.rotation).setDepth(10);
    }
  }

  #createCard(
    view: FieldCardView,
    signature: string,
  ): Phaser.GameObjects.Container {
    const container = this.add
      .container(view.x, view.y)
      .setData("signature", signature);
    const texture = this.#textureFor(view);
    if (this.textures.exists(texture)) {
      const image = this.add.image(0, 0, texture);
      image.setDisplaySize(view.width, view.height);
      container.add(image);
    } else {
      container.add(
        this.add.rectangle(
          0,
          0,
          view.width,
          view.height,
          view.hidden ? 0x3a164c : 0x24334d,
          1,
        ),
      );
      container.add(
        this.add
          .text(0, 0, view.hidden ? "CARD" : String(view.code ?? "?"), {
            color: "#f2e9cf",
            fontFamily: "system-ui, sans-serif",
            fontSize: "11px",
            align: "center",
            wordWrap: { width: view.width - 8 },
          })
          .setOrigin(0.5),
      );
    }
    const border = this.add
      .rectangle(0, 0, view.width + 4, view.height + 4, 0x000000, 0)
      .setName("border")
      .setStrokeStyle(2, 0x7184a3, 1);
    container.add(border);
    container
      .setSize(view.width, view.height)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => {
        if (view.instanceId !== undefined)
          this.#options.onCardIntent(view.instanceId);
      });
    return container;
  }

  #reconcileStacks(next: ReadonlyMap<string, FieldStackView>): void {
    for (const [id, object] of this.#stacks) {
      if (next.has(id)) continue;
      object.destroy(true);
      this.#stacks.delete(id);
    }
    for (const [id, view] of next) {
      let object = this.#stacks.get(id);
      if (object === undefined) {
        const body = this.add.rectangle(0, 0, 72, 104, 0x25113b, 1);
        const label = this.add
          .text(0, 0, "", {
            color: "#f4d58d",
            fontFamily: "system-ui, sans-serif",
            fontSize: "15px",
            fontStyle: "bold",
            align: "center",
          })
          .setName("count")
          .setOrigin(0.5);
        object = this.add.container(view.x, view.y, [body, label]).setDepth(8);
        this.#stacks.set(id, object);
      }
      const count = object.getByName("count") as Phaser.GameObjects.Text | null;
      count?.setText(
        `${view.zone === "deck" ? "Deck" : "Extra"}\n${view.count}`,
      );
      object.setPosition(view.x, view.y);
    }
  }

  #loadTextures(): void {
    if (this.#texturesLoading) return;
    const entries: Array<readonly [string, string]> = [
      ["card-back", this.#cardBackUrl],
      ["card-placeholder", this.#placeholderUrl],
      ...[...this.#imageUrls].map(
        ([code, url]) => [`card-${code}`, url] as const,
      ),
    ];
    const pending = entries
      .filter(([, url]) => url.length > 0)
      .filter(
        ([key]) => !this.textures.exists(key) && !this.#failedTextures.has(key),
      );
    if (pending.length === 0) {
      this.#emitImageReadiness();
      return;
    }
    this.#texturesLoading = true;
    pending.forEach(([key, url]) => this.load.image(key, url));
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.#texturesLoading = false;
      this.#emitImageReadiness();
      if (this.#snapshot !== null) this.applySnapshot(this.#snapshot);
    });
    this.load.start();
  }

  #emitImageReadiness(): void {
    const failed = [...this.#failedTextures];
    this.events.emit("card-images-ready", {
      faceImages: [...this.#imageUrls.keys()].filter((code) =>
        this.textures.exists(`card-${code}`),
      ).length,
      cardBack: this.textures.exists("card-back"),
      failed,
    });
  }

  #textureFor(view: FieldCardView): string {
    if (view.hidden) return "card-back";
    if (view.code !== undefined && this.#imageUrls.has(view.code))
      return `card-${view.code}`;
    return "card-placeholder";
  }
}
