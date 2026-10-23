import Phaser from 'phaser';
import { gameData, type StarSystem } from '../data/schema';
import type { Session } from '../core/session';
import { canJump, jumpBlockText } from '../systems/travel';
import { routeTo, trackedObjective } from '../systems/missions';
import { button, createLayer, el, type Layer } from '../ui/dom';
import { getSession } from './sessionAccess';
import { addStarBackdrop, onScreenResize } from './resize';
import { hexToNumber } from './systemTextures';
import type { FlightResumeData } from './FlightScene';

/** Map units are light-years × 10 (see systems.json). */
const LY = 10;
/** Default zoom shows about this many light-years across the screen's short side. */
const DEFAULT_SPAN_LY = 18;
const MAX_SCALE = 8;
/** A touch that moves less than this is a tap, not a drag. */
const TAP_SLOP = 10;
const TAP_RADIUS = 30;
/** Labels for every system appear once zoomed in at least this far (px per map unit). */
const LABEL_SCALE = 1.6;
/** Screen space kept clear of stars at the bottom for the info panel. */
const PANEL_SPACE_LANDSCAPE = 140;
const PANEL_SPACE_PORTRAIT = 190;
const OBJECTIVE = 0x7ee08a;

/**
 * Star chart, opened while FlightScene sleeps. Drag to pan, pinch to zoom,
 * tap a star to see it; if a lane connects it and there's fuel, tap Jump.
 * Positions come from real 3D star positions, flattened.
 */
export class MapScene extends Phaser.Scene {
  private session!: Session;
  private ui!: Layer;
  private gfx!: Phaser.GameObjects.Graphics;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private selected: string | null = null;
  private panel!: HTMLDivElement;
  private backdrop!: { far: Phaser.GameObjects.TileSprite; near: Phaser.GameObjects.TileSprite };
  private dim!: Phaser.GameObjects.Rectangle;

  // View: which map point is at the screen center, and px per map unit.
  private cx = 0;
  private cy = 0;
  private zoom = 1;
  private minZoom = 0.2;

  // Gesture tracking
  private touches = new Map<number, { x: number; y: number }>();
  private dragDist = 0;
  private pinchStart: { dist: number; zoom: number } | null = null;

  constructor() {
    super('map');
  }

  create(): void {
    this.session = getSession(this);
    this.selected = null;
    this.touches.clear();
    this.pinchStart = null;
    this.labels = new Map();
    this.backdrop = addStarBackdrop(this);
    this.dim = this.add.rectangle(0, 0, 1, 1, 0x04060c, 0.6).setOrigin(0).setDepth(-18);
    this.gfx = this.add.graphics();
    for (const s of gameData.systems.values()) {
      this.labels.set(
        s.id,
        this.add
          .text(0, 0, s.name, { fontFamily: '-apple-system, system-ui, sans-serif', fontSize: '13px', color: '#e4ecff' })
          .setOrigin(0.5, 0)
          .setResolution(Math.min(3, window.devicePixelRatio || 1)),
      );
    }
    this.input.addPointer(1); // two fingers for pinch
    this.buildDom();
    this.fit(true);
    onScreenResize(this, () => {
      this.fit(false);
    });
    this.setupGestures();
  }

  override update(): void {
    if (this.cameras.main.width !== this.scale.width || this.cameras.main.height !== this.scale.height) this.fit(false);
  }

  // ------------------------------------------------------------------ view

  /** Usable area for stars: the whole screen minus the bottom panel. */
  private viewCenterY(): number {
    const { width, height } = this.scale;
    const panel = height > width ? PANEL_SPACE_PORTRAIT : PANEL_SPACE_LANDSCAPE;
    return (height - panel) / 2 + 30;
  }

  private fit(recenter: boolean): void {
    const { width, height } = this.scale;
    this.cameras.resize(width, height);
    this.backdrop.far.setSize(width, height);
    this.backdrop.near.setSize(width, height);
    this.dim.setSize(width, height);

    const systems = [...gameData.systems.values()];
    const spanX = Math.max(...systems.map((s) => s.x)) - Math.min(...systems.map((s) => s.x));
    const spanY = Math.max(...systems.map((s) => s.y)) - Math.min(...systems.map((s) => s.y));
    this.minZoom = Math.min(width / (spanX * 1.15), height / (spanY * 1.3));
    if (recenter) {
      const here = gameData.systems.get(this.session.state.systemId);
      this.cx = here?.x ?? 0;
      this.cy = here?.y ?? 0;
      this.zoom = Math.min(width, height) / (DEFAULT_SPAN_LY * LY);
    }
    this.zoom = Phaser.Math.Clamp(this.zoom, this.minZoom, MAX_SCALE);
    this.draw();
  }

  private toScreen(s: { x: number; y: number }): { x: number; y: number } {
    return { x: this.scale.width / 2 + (s.x - this.cx) * this.zoom, y: this.viewCenterY() + (s.y - this.cy) * this.zoom };
  }

  private draw(): void {
    const state = this.session.state;
    const here = state.systemId;
    const hereSys = gameData.systems.get(here);
    const visited = new Set(state.visited);
    const g = this.gfx;
    g.clear();
    const route = this.objectiveRoute();

    // Lanes: bright if they leave the current system, dim otherwise.
    const drawn = new Set<string>();
    for (const s of gameData.systems.values()) {
      for (const link of s.links) {
        const key = s.id < link ? `${s.id}|${link}` : `${link}|${s.id}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const other = gameData.systems.get(link);
        if (!other) continue;
        const a = this.toScreen(s);
        const b = this.toScreen(other);
        const fromHere = s.id === here || link === here;
        g.lineStyle(fromHere ? 3 : 2, fromHere ? 0x8fd8ff : 0x5b6b8c, fromHere ? 0.9 : 0.4);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
    }

    // The way to your current objective, in green.
    if (route) {
      g.lineStyle(5, OBJECTIVE, 0.85);
      for (let i = 1; i < route.length; i += 1) {
        const a = gameData.systems.get(route[i - 1] ?? '');
        const b = gameData.systems.get(route[i] ?? '');
        if (!a || !b) continue;
        const pa = this.toScreen(a);
        const pb = this.toScreen(b);
        g.lineBetween(pa.x, pa.y, pb.x, pb.y);
      }
      const goal = gameData.systems.get(route[route.length - 1] ?? '');
      if (goal) {
        const p = this.toScreen(goal);
        g.lineStyle(3, OBJECTIVE, 1);
        g.strokeCircle(p.x, p.y, 24);
      }
    }

    for (const s of gameData.systems.values()) {
      const p = this.toScreen(s);
      const known = visited.has(s.id);
      const near = s.id === here || s.id === this.selected || (hereSys?.links.includes(s.id) ?? false);
      g.fillStyle(hexToNumber(s.star.color), known || near ? 1 : 0.55);
      g.fillCircle(p.x, p.y, known ? 8 : 6);
      if (s.id === here) {
        g.lineStyle(2, 0xffffff, 0.9);
        g.strokeCircle(p.x, p.y, 14);
      }
      if (s.id === this.selected) {
        g.lineStyle(3, 0xffd27a, 1);
        g.strokeCircle(p.x, p.y, 19);
      }
      const label = this.labels.get(s.id);
      if (label) {
        label
          .setPosition(p.x, p.y + 14)
          .setVisible(near || this.zoom >= LABEL_SCALE || (route?.includes(s.id) ?? false))
          .setColor(known ? '#e4ecff' : '#8e9ab5');
      }
    }
  }

  /** Jump route from here to the tracked objective's system (null if none or you're there). */
  private objectiveRoute(): string[] | null {
    const state = this.session.state;
    const target = trackedObjective(state, gameData)?.target;
    if (!target || target.system === state.systemId) return null;
    return routeTo(state.systemId, target.system, gameData);
  }

  // ------------------------------------------------------------------ gestures

  private setupGestures(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      this.touches.set(p.id, { x: p.x, y: p.y });
      if (this.touches.size === 1) this.dragDist = 0;
      if (this.touches.size === 2) {
        this.pinchStart = { dist: this.pinchDistance(), zoom: this.zoom };
        this.dragDist = TAP_SLOP + 1; // a pinch is never a tap
      }
    });

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      const prev = this.touches.get(p.id);
      if (!prev || !p.isDown) return;
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      this.touches.set(p.id, { x: p.x, y: p.y });
      if (this.touches.size >= 2 && this.pinchStart) {
        const d = this.pinchDistance();
        if (this.pinchStart.dist > 0) {
          this.zoom = Phaser.Math.Clamp((this.pinchStart.zoom * d) / this.pinchStart.dist, this.minZoom, MAX_SCALE);
        }
        // Two-finger drag also pans (half each finger's motion).
        this.cx -= dx / this.zoom / 2;
        this.cy -= dy / this.zoom / 2;
      } else {
        this.dragDist += Math.hypot(dx, dy);
        this.cx -= dx / this.zoom;
        this.cy -= dy / this.zoom;
      }
      this.draw();
    });

    const up = (p: Phaser.Input.Pointer): void => {
      const wasTap = this.touches.size === 1 && this.dragDist <= TAP_SLOP;
      this.touches.delete(p.id);
      if (this.touches.size < 2) this.pinchStart = null;
      if (wasTap) this.tapAt(p.x, p.y);
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, up);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, up);
    const onBlur = (): void => {
      this.touches.clear();
      this.pinchStart = null;
    };
    this.game.events.on(Phaser.Core.Events.BLUR, onBlur);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, onBlur);
    });
  }

  private pinchDistance(): number {
    const pts = [...this.touches.values()];
    const a = pts[0];
    const b = pts[1];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private tapAt(x: number, y: number): void {
    let best: string | null = null;
    let bestD = TAP_RADIUS;
    for (const s of gameData.systems.values()) {
      const p = this.toScreen(s);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bestD) {
        bestD = d;
        best = s.id;
      }
    }
    if (best !== null) {
      this.selected = best;
      this.draw();
      this.renderPanel();
    }
  }

  // ------------------------------------------------------------------ DOM

  private buildDom(): void {
    this.ui = createLayer('map');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ui.destroy();
    });
    const header = el('div', 'chip hud-tl', el('b', '', 'Star chart'));
    const center = button('Center', () => {
      this.fit(true);
    });
    const close = button('Close', () => {
      this.close();
    });
    this.panel = el('div', 'panel card');
    const bottom = el('div', 'hud-bc', this.panel);
    bottom.style.width = 'min(560px, calc(100% - 24px))';
    this.panel.style.padding = '12px 16px';
    this.ui.root.append(header, el('div', 'hud-tr', center, close), bottom);
    this.renderPanel();
  }

  private renderPanel(): void {
    const state = this.session.state;
    this.panel.replaceChildren();
    const sys: StarSystem | undefined = this.selected === null ? undefined : gameData.systems.get(this.selected);
    const obj = trackedObjective(state, gameData);
    const route = this.objectiveRoute();
    if (!sys) {
      if (obj) this.panel.append(el('div', 'objective', obj.text));
      const next = route?.[1];
      const nextSys = next === undefined ? undefined : gameData.systems.get(next);
      if (nextSys) {
        const go = button(`Jump to ${nextSys.name}${route && route.length > 2 ? ` (1 of ${route.length - 1})` : ''}`, () => {
          this.jump(nextSys.id);
        }, 'primary');
        go.style.width = '100%';
        go.style.marginTop = '8px';
        this.panel.append(go);
        return;
      }
      this.panel.append(el('div', 'sub', 'Drag to pan, pinch to zoom, tap a star. Bright lanes lead out of your current system.'));
      return;
    }
    const known = state.visited.includes(sys.id);
    const sites = sys.bodies.reduce((n, b) => n + b.sites.length, 0);
    const facts = [sys.spectral, sys.distanceLy > 0 ? `${sys.distanceLy} ly from Sol` : 'home'].filter(Boolean).join(' · ');
    this.panel.append(
      el('div', '', el('b', '', sys.name), el('span', 'sub', `  ·  ${facts}`)),
      el('p', '', known ? `${sys.description} ${sites} landing site${sites === 1 ? '' : 's'}.` : sys.description),
    );
    if (sys.id === state.systemId) {
      this.panel.append(el('div', 'sub', "You're here."));
      return;
    }
    if (route?.includes(sys.id)) this.panel.append(el('div', 'objective', sys.id === route[route.length - 1] ? `Your objective: ${obj?.text ?? ''}` : 'On the way to your objective'));
    const check = canJump(state, sys.id, gameData);
    const go = button(check.ok ? `Jump to ${sys.name}` : jumpBlockText(check.reason), () => {
      this.jump(sys.id);
    }, check.ok ? 'primary' : '');
    go.disabled = !check.ok;
    go.style.width = '100%';
    this.panel.append(go);
  }

  private close(): void {
    this.scene.stop();
    this.scene.wake('flight', {} satisfies FlightResumeData);
  }

  private jump(toId: string): void {
    this.scene.stop();
    this.scene.wake('flight', { jumpTo: toId } satisfies FlightResumeData);
  }
}
