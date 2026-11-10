import sqs from "../shortQuerySelector";
import type { QueueManager } from "./QueueManager";
import type { QueueTrackEntry } from "./QueueTrackEntry";
import { queueMotion } from "./QueueMotion";
import { reducedMotion } from "../motion";

const dragHoldMilliseconds = 200;
const pointerTolerancePixels = 10;
const scrollEdgePixels = 48;
const scrollPixelsPerSecond = 700;
const selectionMotion = { duration: 200, easing: "cubic-bezier(0, 0.78, 0.17, 1)" };

interface PointerPosition {
    x: number;
    y: number;
}

interface Bounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** Where the rows are, measured once and reused until something moves them. */
interface RowLayout {
    /** Row bounds in the list's scroll coordinates, in queue order. */
    rows: Map<Element, Bounds>;
    /** Rows whose own transform is animating, which are not where layout puts them. */
    moving: Set<Element>;
    scrollHeight: number;
}

interface SelectionGroup extends Bounds {
    dragging: boolean;
    moving: boolean;
    entries: Set<QueueTrackEntry>;
}

interface SelectionHighlight {
    element: HTMLDivElement;
    entries: Set<QueueTrackEntry>;
}

interface GestureStart {
    pointerId: number;
    origin: PointerPosition;
    clientOrigin: PointerPosition;
    pointer: PointerPosition;
    entry: QueueTrackEntry | undefined;
    initialSelection: Set<QueueTrackEntry>;
    additive: boolean;
    extendRange: boolean;
    startedInSelectionGap: boolean;
}

type QueueGesture = GestureStart &
    (
        | { kind: "pending" }
        | { kind: "selecting" }
        | {
              kind: "dragging";
              entries: QueueTrackEntry[];
              dragged: Set<QueueTrackEntry>;
              previewSize: { width: number; height: number };
              beforeEntry: QueueTrackEntry | null;
              intoHistory: boolean;
              hasMoved: boolean;
              validDrop: boolean;
          }
    );

/** Rounds to a whole device pixel, where a translated overlay stays as sharp as a laid out one. */
function snapToDevicePixel(value: number) {
    return Math.round(value * devicePixelRatio) / devicePixelRatio;
}

function sameEntries(a: Set<QueueTrackEntry>, b: Set<QueueTrackEntry>) {
    if (a.size !== b.size) return false;
    for (const entry of a) if (!b.has(entry)) return false;
    return true;
}

export class QueueInteraction {
    #element: HTMLElement;
    #queue: QueueManager;
    #selected = new Set<QueueTrackEntry>();
    /** Mirrors the rows' `data-grouped` attribute, so rendering doesn't read it back from the DOM. */
    #grouped = new Set<QueueTrackEntry>();
    #rowLayoutCache: RowLayout | undefined;
    #selectionAnchor: QueueTrackEntry | undefined;
    #focusedEntry: QueueTrackEntry | undefined;
    #nextOptionId = 0;
    #gesture: QueueGesture | undefined;
    /** The pointer or the list moved since the gesture was last applied. */
    #gestureChanged = false;
    #holdTimer: number | undefined;
    #gestureFrame: number | undefined;
    #selectionFrame: number | undefined;
    #dropIndicator = document.createElement("div");
    #dragPreview = document.createElement("div");
    #selectionLayer = document.createElement("div");
    #selectionHighlights: SelectionHighlight[] = [];
    #selectionMerges = new Map<HTMLElement, Animation>();
    #hoverBorderAnimations = new Map<HTMLElement, Animation>();
    #overlayAnimations = new Map<HTMLElement, Animation>();
    #selectionResizeObserver = new ResizeObserver((entries) =>
        this.#rowsResized(entries),
    );

    constructor(element: HTMLElement, queue: QueueManager) {
        this.#element = element;
        this.#queue = queue;
        this.#dropIndicator.className = "queueDropIndicator";
        this.#dragPreview.className = "queueDragPreview";
        this.#selectionLayer.className = "queueSelectionLayer";
        for (const overlay of [this.#dropIndicator, this.#dragPreview, this.#selectionLayer])
            overlay.setAttribute("aria-hidden", "true");
    }

    Initialize() {
        this.#element.setAttribute("role", "listbox");
        this.#element.setAttribute("aria-label", "Queue");
        this.#element.setAttribute("aria-multiselectable", "true");
        this.#element.tabIndex = 0;
        this.#element.appendChild(this.#selectionLayer);
        this.#selectionResizeObserver.observe(this.#element);
        this.#element.addEventListener("pointerdown", (event) =>
            this.#startGesture(event),
        );
        this.#element.addEventListener("pointermove", (event) =>
            this.#movePointer(event),
        );
        this.#element.addEventListener("pointerup", (event) =>
            this.#releasePointer(event),
        );
        this.#element.addEventListener("pointercancel", () =>
            this.CancelGesture(),
        );
        this.#element.addEventListener("lostpointercapture", () =>
            this.CancelGesture(),
        );
        this.#element.addEventListener("dragstart", (event) =>
            event.preventDefault(),
        );
        this.#element.addEventListener("scroll", () => {
            this.#gestureChanged = true;
        });
        this.#element.addEventListener("keydown", (event) =>
            this.#handleKey(event),
        );
        document.addEventListener(
            "pointerdown",
            (event) => {
                if (
                    !(event.target instanceof Element) ||
                    this.#element.contains(event.target) ||
                    event.target.closest("#appContextMenu")
                )
                    return;
                this.CancelGesture();
                this.#setSelection([]);
                this.#selectionAnchor = undefined;
                this.#setFocusedEntry(undefined);
            },
            { capture: true },
        );
        window.addEventListener("blur", () => this.CancelGesture());
        window.addEventListener("resize", () => this.CancelGesture());
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) this.CancelGesture();
        });
        reducedMotion.addEventListener("change", () => {
            if (!reducedMotion.matches) return;
            for (const animation of this.#overlayAnimations.values())
                animation.finish();
            for (const animation of this.#selectionMerges.values())
                animation.finish();
            for (const animation of this.#hoverBorderAnimations.values())
                animation.finish();
        });
    }

    get SelectedEntries() {
        return this.#queue.queue.filter((entry) => this.#selected.has(entry));
    }

    SelectForContextMenu(entry: QueueTrackEntry) {
        this.CancelGesture();
        if (!this.#selected.has(entry)) this.#setSelection([entry]);
        this.#selectionAnchor = entry;
        this.#setFocusedEntry(entry);
    }

    TrackAdded() {
        this.#rowLayoutCache = undefined;
        this.CancelGesture();
        this.#scheduleSelectionHighlights();
    }

    QueueChanged() {
        this.#rowLayoutCache = undefined;
        this.CancelGesture();
        // The rows may have moved even when the same ones stay selected.
        if (!this.#setSelection(this.SelectedEntries)) this.#renderSelectionHighlights();
        if (
            this.#selectionAnchor &&
            !this.#queue.queue.includes(this.#selectionAnchor)
        )
            this.#selectionAnchor = undefined;
        if (
            this.#focusedEntry &&
            !this.#queue.queue.includes(this.#focusedEntry)
        )
            this.#setFocusedEntry(undefined);
    }

    CancelGesture() {
        const gesture = this.#gesture;
        this.#gesture = undefined;
        window.clearTimeout(this.#holdTimer);
        this.#holdTimer = undefined;
        if (this.#gestureFrame !== undefined)
            cancelAnimationFrame(this.#gestureFrame);
        this.#gestureFrame = undefined;
        this.#gestureChanged = false;
        this.#hideOverlay(this.#dropIndicator);
        this.#hideOverlay(this.#dragPreview);
        delete this.#element.dataset.gesture;
        if (!gesture) return;
        if (gesture.kind === "dragging") {
            for (const entry of gesture.entries)
                entry.track.domElement?.removeAttribute("data-dragging");
            this.#renderSelectionHighlights();
        }
        if (this.#element.hasPointerCapture(gesture.pointerId))
            this.#element.releasePointerCapture(gesture.pointerId);
    }

    /** Overlays default to #app, which defines the accent colour they paint with. */
    #showOverlay(element: HTMLElement, parent: HTMLElement = sqs<HTMLElement>("#app")) {
        if (element.isConnected && element.dataset.exiting !== "true") return;
        const opacity = element.isConnected ? getComputedStyle(element).opacity : "0";
        this.#overlayAnimations.get(element)?.cancel();
        this.#overlayAnimations.delete(element);
        delete element.dataset.exiting;
        parent.appendChild(element);
        if (reducedMotion.matches) return;
        // A lone first keyframe fades to the element's own opacity without reading it back.
        const animation = element.animate(
            { opacity, offset: 0 },
            { ...queueMotion, duration: 180 },
        );
        this.#overlayAnimations.set(element, animation);
        animation.onfinish = () => {
            if (this.#overlayAnimations.get(element) === animation)
                this.#overlayAnimations.delete(element);
        };
    }

    #hideOverlay(element: HTMLElement) {
        if (!element.isConnected || element.dataset.exiting === "true") return;
        const opacity = getComputedStyle(element).opacity;
        this.#overlayAnimations.get(element)?.cancel();
        this.#overlayAnimations.delete(element);
        element.dataset.exiting = "true";
        if (reducedMotion.matches) {
            element.remove();
            return;
        }
        const animation = element.animate(
            [{ opacity }, { opacity: 0 }],
            { ...queueMotion, duration: 150, fill: "forwards" },
        );
        this.#overlayAnimations.set(element, animation);
        animation.onfinish = () => {
            if (this.#overlayAnimations.get(element) !== animation) return;
            element.remove();
            animation.cancel();
            this.#overlayAnimations.delete(element);
        };
    }

    #setFocusedEntry(entry: QueueTrackEntry | undefined) {
        this.#focusedEntry = entry;
        const element = entry?.track.domElement;
        if (element) {
            element.id ||= `${this.#element.id}-option-${this.#nextOptionId++}`;
            this.#element.setAttribute("aria-activedescendant", element.id);
        } else this.#element.removeAttribute("aria-activedescendant");
    }

    /** Returns whether the selection changed. */
    #setSelection(entries: Iterable<QueueTrackEntry>) {
        const requested = new Set(entries);
        const selected = new Set(
            this.#queue.queue.filter((entry) => requested.has(entry)),
        );
        if (sameEntries(selected, this.#selected)) return false;
        // Measured before the rows are written to, so reading their bounds doesn't force a restyle.
        const layout = selected.size ? this.#rowLayout() : undefined;
        const deselectedElements: HTMLElement[] = [];
        for (const entry of new Set([...this.#selected, ...selected])) {
            const isSelected = selected.has(entry);
            if (this.#selected.has(entry) === isSelected) continue;
            const element = entry.track.domElement;
            if (!element) continue;
            this.#hoverBorderAnimations.get(element)?.cancel();
            this.#hoverBorderAnimations.delete(element);
            element.style.removeProperty("--queue-hover-clip");
            if (isSelected) this.#selectionResizeObserver.observe(element);
            else {
                this.#selectionResizeObserver.unobserve(element);
                this.#grouped.delete(entry);
                delete element.dataset.grouped;
                element.dataset.hoverInstant = "true";
                deselectedElements.push(element);
            }
            element.setAttribute(
                "data-selected",
                String(isSelected),
            );
            element.setAttribute(
                "aria-selected",
                String(isSelected),
            );
        }
        this.#selected = selected;
        this.#renderSelectionHighlights(layout);
        if (deselectedElements.length)
            requestAnimationFrame(() => {
                // Paint the immediate reveal before restoring the hover transition.
                requestAnimationFrame(() => {
                    for (const element of deselectedElements)
                        delete element.dataset.hoverInstant;
                });
            });
        return true;
    }

    /** The list's scroll origin in viewport coordinates. */
    #listOrigin(): PointerPosition {
        const bounds = this.#element.getBoundingClientRect();
        return {
            x: bounds.left - this.#element.scrollLeft,
            y: bounds.top - this.#element.scrollTop,
        };
    }

    #contentBounds(element: Element, origin: PointerPosition): Bounds {
        const bounds = element.getBoundingClientRect();
        return {
            left: bounds.left - origin.x,
            top: bounds.top - origin.y,
            right: bounds.right - origin.x,
            bottom: bounds.bottom - origin.y,
        };
    }

    /**
     * Measures every row in one pass. The result is reused until the queue changes, a row resizes or the
     * list's content height changes, so gestures and highlights don't lay the list out again on every frame.
     */
    #rowLayout(): RowLayout {
        const scrollHeight = this.#element.scrollHeight;
        if (this.#rowLayoutCache?.scrollHeight === scrollHeight) return this.#rowLayoutCache;
        const moving = new Set<Element>();
        for (const animation of this.#element.getAnimations({ subtree: true })) {
            const effect = animation.effect;
            if (
                animation.playState !== "running" ||
                !(effect instanceof KeyframeEffect) ||
                effect.pseudoElement ||
                effect.target?.parentElement !== this.#element
            )
                continue;
            if (effect.getKeyframes().some((frame) => "translate" in frame || "transform" in frame))
                moving.add(effect.target);
        }
        const origin = this.#listOrigin();
        const rows = new Map<Element, Bounds>();
        for (const entry of this.#queue.queue) {
            const element = entry.track.domElement;
            if (element) rows.set(element, this.#contentBounds(element, origin));
        }
        const layout = { rows, moving, scrollHeight };
        // A moving row's bounds hold for one frame only.
        this.#rowLayoutCache = moving.size ? undefined : layout;
        return layout;
    }

    #rowsResized(entries: ResizeObserverEntry[]) {
        const layout = this.#rowLayoutCache;
        // Observing a row reports its size once, which the measured layout already has.
        const unchanged = layout && entries.every(({ target, borderBoxSize }) => {
            const row = layout.rows.get(target);
            const size = borderBoxSize[0];
            return row && size &&
                Math.abs(row.right - row.left - size.inlineSize) < 0.05 &&
                Math.abs(row.bottom - row.top - size.blockSize) < 0.05;
        });
        if (unchanged) return;
        this.#rowLayoutCache = undefined;
        this.#renderSelectionHighlights();
    }

    #scheduleSelectionHighlights() {
        if (!this.#selected.size || this.#selectionFrame !== undefined) return;
        this.#selectionFrame = requestAnimationFrame(() => {
            this.#selectionFrame = undefined;
            this.#renderSelectionHighlights();
        });
    }

    /** Runs of selected rows that sit next to each other, each of which one highlight covers. */
    #selectionGroups(layout: RowLayout) {
        const groups: SelectionGroup[] = [];
        let entries = this.#queue.queue;
        // Rows in the middle of a move are out of queue order.
        if (layout.moving.size)
            entries = [...entries].sort((a, b) =>
                (layout.rows.get(a.track.domElement!)?.top ?? 0) - (layout.rows.get(b.track.domElement!)?.top ?? 0),
            );
        const dragged = this.#gesture?.kind === "dragging" ? this.#gesture.dragged : undefined;
        let group: SelectionGroup | undefined;
        for (const entry of entries) {
            const element = entry.track.domElement;
            const bounds = element && layout.rows.get(element);
            if (!element || !bounds) continue;
            if (!this.#selected.has(entry)) {
                group = undefined;
                continue;
            }
            const dragging = dragged?.has(entry) ?? false;
            const moving = layout.moving.has(element);
            if (!group || group.dragging !== dragging || bounds.top > group.bottom + 11) {
                group = { ...bounds, dragging, moving, entries: new Set([entry]) };
                groups.push(group);
            } else {
                group.left = Math.min(group.left, bounds.left);
                group.right = Math.max(group.right, bounds.right);
                group.bottom = Math.max(group.bottom, bounds.bottom);
                group.moving ||= moving;
                group.entries.add(entry);
            }
        }
        return groups;
    }

    #renderSelectionHighlights(layout?: RowLayout) {
        if (this.#selectionFrame !== undefined)
            cancelAnimationFrame(this.#selectionFrame);
        this.#selectionFrame = undefined;
        layout ??= this.#selected.size ? this.#rowLayout() : undefined;
        const groups = layout ? this.#selectionGroups(layout) : [];
        if (layout) this.#splitSelectionHighlights(groups, layout);
        const owners = new Map<QueueTrackEntry, SelectionHighlight>();
        const previousOrder = new Map<SelectionHighlight, number>();
        for (const [index, highlight] of this.#selectionHighlights.entries()) {
            previousOrder.set(highlight, index);
            for (const entry of highlight.entries) if (!owners.has(entry)) owners.set(entry, highlight);
        }
        const unusedHighlights = new Set(this.#selectionHighlights);
        this.#selectionHighlights = [];
        let origin: PointerPosition | undefined;
        let animating = false;
        for (const group of groups) {
            const matching = new Set<SelectionHighlight>();
            for (const entry of group.entries) {
                const owner = owners.get(entry);
                if (owner && unusedHighlights.has(owner)) matching.add(owner);
            }
            const matches = [...matching].sort((a, b) => previousOrder.get(a)! - previousOrder.get(b)!);
            let selection = matches[0];
            if (!selection) {
                const element = document.createElement("div");
                element.className = "queueSelectionHighlight";
                element.setAttribute("aria-hidden", "true");
                selection = { element, entries: group.entries };
            }
            const highlight = selection.element;
            if (group.moving || !sameEntries(selection.entries, group.entries))
                this.#cancelSelectionMerge(highlight);
            const merging = matches.length > 1 && !group.moving && !reducedMotion.matches;
            // Only a merge needs to know where the highlights are now, which costs a layout to read.
            const previousBounds = merging
                ? matches.map(({ element }) => this.#contentBounds(element, (origin ??= this.#listOrigin())))
                : [];
            for (const previous of matches) {
                unusedHighlights.delete(previous);
                if (previous === selection) continue;
                this.#cancelSelectionMerge(previous.element);
                this.#overlayAnimations.get(previous.element)?.cancel();
                this.#overlayAnimations.delete(previous.element);
                previous.element.remove();
            }
            selection.entries = group.entries;
            this.#selectionHighlights.push(selection);
            if (merging) highlight.dataset.merging = "true";
            animating ||= group.moving;
            highlight.dataset.dragging = String(group.dragging);
            highlight.dataset.moving = String(group.moving);
            Object.assign(highlight.style, {
                left: `${group.left}px`,
                top: `${group.top}px`,
                width: `${group.right - group.left}px`,
                height: `${group.bottom - group.top}px`,
            });
            if (merging) this.#animateSelectionMerge(highlight, previousBounds, group, layout!);
            // Set after the merge, which reads the hover border's opacity for the gap it animates.
            const grouped = group.entries.size > 1;
            for (const entry of group.entries) {
                if (this.#grouped.has(entry) === grouped) continue;
                if (grouped) this.#grouped.add(entry);
                else this.#grouped.delete(entry);
                entry.track.domElement!.dataset.grouped = String(grouped);
            }
            this.#showOverlay(highlight, this.#selectionLayer);
        }
        for (const { element } of unusedHighlights) {
            this.#cancelSelectionMerge(element);
            this.#hideOverlay(element);
        }
        if (animating) this.#scheduleSelectionHighlights();
    }

    #splitSelectionHighlights(groups: SelectionGroup[], layout: RowLayout) {
        // A highlight only splits when its rows end up in more than one group.
        if (reducedMotion.matches || groups.length < 2) return;
        const groupOf = new Map<QueueTrackEntry, SelectionGroup>();
        const groupOrder = new Map<SelectionGroup, number>();
        for (const [index, group] of groups.entries()) {
            groupOrder.set(group, index);
            for (const entry of group.entries) groupOf.set(entry, group);
        }
        const splitHighlights: SelectionHighlight[] = [];
        let origin: PointerPosition | undefined;
        for (const selection of [...this.#selectionHighlights]) {
            const covered = new Set<SelectionGroup>();
            for (const entry of selection.entries) {
                const group = groupOf.get(entry);
                if (group) covered.add(group);
            }
            const parts = [...covered].sort((a, b) => groupOrder.get(a)! - groupOrder.get(b)!);
            if (parts.length < 2 || parts.some((part) => part.moving)) continue;
            const bounds = this.#contentBounds(selection.element, (origin ??= this.#listOrigin()));
            const entries = selection.entries;
            this.#cancelSelectionMerge(selection.element);
            for (let index = 1; index < parts.length; index++)
                this.#animateHoverBorderGap(entries, parts[index - 1].bottom, parts[index].top, "opening", layout);
            for (const [index, part] of parts.entries()) {
                const top = index === 0 ? bounds.top :
                    Math.max(bounds.top, Math.min(bounds.bottom, (parts[index - 1].bottom + part.top) / 2));
                const bottom = index === parts.length - 1 ? bounds.bottom :
                    Math.max(top, Math.min(bounds.bottom, (part.bottom + parts[index + 1].top) / 2));
                const highlight = index === 0 ? selection : {
                    element: selection.element.cloneNode() as HTMLDivElement,
                    entries: new Set<QueueTrackEntry>(),
                };
                highlight.entries = new Set([...part.entries].filter((entry) => entries.has(entry)));
                Object.assign(highlight.element.style, {
                    transitionProperty: "none",
                    top: `${top}px`,
                    height: `${bottom - top}px`,
                });
                if (index > 0) {
                    this.#selectionLayer.appendChild(highlight.element);
                    this.#selectionHighlights.push(highlight);
                }
                splitHighlights.push(highlight);
            }
        }
        for (const { element } of splitHighlights) {
            // Commit each slice's starting bounds before its edges transition to the selected rows.
            element.getBoundingClientRect();
            element.style.removeProperty("transition-property");
        }
    }

    #cancelSelectionMerge(element: HTMLElement) {
        this.#selectionMerges.get(element)?.cancel();
        this.#selectionMerges.delete(element);
        delete element.dataset.merging;
    }

    /** `top` and `bottom` bound the gap in the list's scroll coordinates. */
    #animateHoverBorderGap(
        entries: Iterable<QueueTrackEntry>, top: number, bottom: number, direction: "opening" | "closing",
        layout: RowLayout,
    ) {
        const middle = (top + bottom) / 2;
        for (const entry of entries) {
            const element = entry.track.domElement;
            const bounds = element && layout.rows.get(element);
            if (!element || !bounds) continue;
            if (bounds.bottom <= top || bounds.top >= bottom) continue;
            const gap = `inset(${top - bounds.top}px 0px ${bounds.bottom - bottom}px)`;
            const seam = `inset(${middle - bounds.top}px 0px ${bounds.bottom - middle}px)`;
            const opening = direction === "opening";
            const opacity = getComputedStyle(element, "::after").opacity;
            const duration = opening ? selectionMotion.duration : selectionMotion.duration + 180;
            this.#hoverBorderAnimations.get(element)?.cancel();
            element.style.setProperty("--queue-hover-clip", opening ? gap : seam);
            // Only the border inside the animated gap is visible beneath the translucent highlights.
            const animation = element.animate(
                opening ? [
                    { clipPath: seam, easing: selectionMotion.easing },
                    { clipPath: gap },
                ] : [
                    { clipPath: gap, opacity, offset: 0, easing: selectionMotion.easing },
                    { clipPath: seam, opacity, offset: selectionMotion.duration / duration, easing: queueMotion.easing },
                    { clipPath: seam, opacity: 0, offset: 1 },
                ],
                { duration, pseudoElement: "::after" },
            );
            this.#hoverBorderAnimations.set(element, animation);
            animation.onfinish = () => {
                if (this.#hoverBorderAnimations.get(element) === animation)
                    this.#hoverBorderAnimations.delete(element);
            };
        }
    }

    #animateSelectionMerge(element: HTMLElement, previous: Bounds[], group: SelectionGroup, layout: RowLayout) {
        const height = group.bottom - group.top;
        const segments = previous
            .map((bounds) => ({
                top: Math.max(0, bounds.top - group.top),
                bottom: Math.min(height, bounds.bottom - group.top),
            }))
            .filter((segment) => segment.bottom > segment.top)
            .sort((a, b) => a.top - b.top);
        if (segments.length < 2) {
            this.#cancelSelectionMerge(element);
            return;
        }
        for (let index = 1; index < segments.length; index++)
            this.#animateHoverBorderGap(group.entries, group.top + segments[index - 1].bottom,
                group.top + segments[index].top, "closing", layout);
        const filledSegments = segments.map((segment, index) => ({
            top: index === 0 ? 0 : (segments[index - 1].bottom + segment.top) / 2,
            bottom: index === segments.length - 1 ? height : (segment.bottom + segments[index + 1].top) / 2,
        }));
        const polygon = (regions: typeof segments) => {
            const points = regions.flatMap(({ top, bottom }) =>
                [`0% ${top}px`, `100% ${top}px`, `100% ${bottom}px`, `0% ${bottom}px`],
            );
            // Rectangles connect along the left edge so only the gaps between them expand.
            return `polygon(${points.join(", ")})`;
        };
        const animation = element.animate(
            [{ clipPath: polygon(segments) }, { clipPath: polygon(filledSegments) }],
            selectionMotion,
        );
        this.#selectionMerges.set(element, animation);
        animation.onfinish = () => {
            if (this.#selectionMerges.get(element) === animation)
                this.#cancelSelectionMerge(element);
        };
    }

    #selectRange(entry: QueueTrackEntry, additive: boolean) {
        this.#selectionAnchor ??= entry;
        const anchorIndex = this.#queue.queue.indexOf(this.#selectionAnchor);
        const entryIndex = this.#queue.queue.indexOf(entry);
        const range = this.#queue.queue.slice(
            Math.min(anchorIndex, entryIndex),
            Math.max(anchorIndex, entryIndex) + 1,
        );
        this.#setSelection(additive ? [...this.#selected, ...range] : range);
    }

    #startGesture(event: PointerEvent) {
        if (
            event.button !== 0 ||
            !event.isPrimary ||
            event.pointerType === "touch" ||
            this.#gesture ||
            (event.target instanceof Element && event.target.closest(".queuePlayButton"))
        )
            return;
        const bounds = this.#element.getBoundingClientRect();
        const viewportLeft = bounds.left + this.#element.clientLeft;
        const viewportTop = bounds.top + this.#element.clientTop;
        let viewportRight = viewportLeft + this.#element.clientWidth;
        if (
            this.#element.scrollHeight > this.#element.clientHeight &&
            this.#element.offsetWidth === this.#element.clientWidth
        ) {
            // Overlay scrollbars occupy the right padding without reducing clientWidth.
            viewportRight -= parseFloat(getComputedStyle(this.#element).paddingRight);
        }
        if (
            event.clientX < viewportLeft || event.clientX >= viewportRight ||
            event.clientY < viewportTop ||
            event.clientY >= viewportTop + this.#element.clientHeight
        ) return;
        const target =
            event.target instanceof Element
                ? event.target.closest(".queueItem")
                : null;
        if (target?.hasAttribute("data-removed")) return;
        let entry = this.#queue.queue.find(
            (entry) => entry.track.domElement === target,
        );
        const selectedGroup = !entry && this.#selectionHighlights.find(({ element }) => {
            const highlight = element.getBoundingClientRect();
            return event.clientX >= highlight.left && event.clientX < highlight.right &&
                event.clientY >= highlight.top && event.clientY < highlight.bottom;
        });
        const startedInSelectionGap = Boolean(selectedGroup);
        if (selectedGroup)
            entry = [...selectedGroup.entries].find(
                (entry) => !entry.track.isPlaying,
            ) ?? selectedGroup.entries.values().next().value;
        const additive = event.ctrlKey || event.metaKey;
        const initialSelection = new Set(this.#selected);
        const pointer = { x: event.clientX, y: event.clientY };
        const origin = this.#contentPosition(pointer);

        if (!startedInSelectionGap) {
            if (entry && event.shiftKey) this.#selectRange(entry, additive);
            else if (entry && !this.#selected.has(entry))
                this.#setSelection(additive ? [...this.#selected, entry] : [entry]);
            else if (!entry && !additive) this.#setSelection([]);
        }
        if (entry && !event.shiftKey && !startedInSelectionGap) this.#selectionAnchor = entry;
        this.#setFocusedEntry(entry);

        const gesture: QueueGesture = {
            kind: "pending",
            pointerId: event.pointerId,
            entry,
            initialSelection,
            additive,
            extendRange: event.shiftKey,
            startedInSelectionGap,
            pointer,
            clientOrigin: pointer,
            origin,
        };
        this.#gesture = gesture;
        this.#element.focus({ preventScroll: true });
        this.#element.setPointerCapture(event.pointerId);
        if (entry && !entry.track.isPlaying) {
            this.#holdTimer = window.setTimeout(() => {
                if (this.#gesture !== gesture) return;
                const entries = this.SelectedEntries.filter(
                    (entry) => !entry.track.isPlaying,
                );
                if (!entries.length) return;
                const dragging: QueueGesture = {
                    ...gesture,
                    kind: "dragging",
                    entries,
                    dragged: new Set(entries),
                    previewSize: { width: 0, height: 0 },
                    beforeEntry: null,
                    intoHistory: false,
                    hasMoved: false,
                    validDrop: false,
                };
                this.#gesture = dragging;
                this.#element.dataset.gesture = "dragging";
                for (const entry of entries)
                    entry.track.domElement?.setAttribute(
                        "data-dragging",
                        "true",
                    );
                this.#renderSelectionHighlights();
                this.#dragPreview.textContent =
                    entries.length === 1
                        ? entries[0].track.title
                        : `${entries.length} tracks`;
                this.#showOverlay(this.#dragPreview);
                // The preview keeps this size for the whole drag.
                dragging.previewSize = {
                    width: this.#dragPreview.offsetWidth,
                    height: this.#dragPreview.offsetHeight,
                };
                this.#updateGesture();
                this.#startGestureFrames();
            }, dragHoldMilliseconds);
        }
    }

    #movePointer(event: PointerEvent) {
        const gesture = this.#gesture;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        if (!(event.buttons & 1)) {
            this.CancelGesture();
            return;
        }
        gesture.pointer = { x: event.clientX, y: event.clientY };
        const distance =
            Math.abs(event.clientX - gesture.clientOrigin.x) +
            Math.abs(event.clientY - gesture.clientOrigin.y);
        if (gesture.kind === "pending" && distance > pointerTolerancePixels) {
            window.clearTimeout(this.#holdTimer);
            this.#gesture = { ...gesture, kind: "selecting" };
            this.#element.dataset.gesture = "selecting";
            this.#startGestureFrames();
        } else if (
            gesture.kind === "dragging" &&
            distance > pointerTolerancePixels
        ) {
            gesture.hasMoved = true;
        }
        // Pointer events can outnumber frames, so the frame loop applies the latest position.
        this.#gestureChanged = true;
        event.preventDefault();
    }

    #releasePointer(event: PointerEvent) {
        const gesture = this.#gesture;
        if (
            !gesture ||
            gesture.pointerId !== event.pointerId ||
            event.button !== 0
        )
            return;
        gesture.pointer = { x: event.clientX, y: event.clientY };
        this.#updateGesture();
        this.CancelGesture();
        if (
            gesture.kind === "pending" &&
            gesture.entry &&
            !gesture.startedInSelectionGap &&
            !gesture.extendRange
        ) {
            if (gesture.additive && gesture.initialSelection.has(gesture.entry))
                this.#setSelection(
                    [...gesture.initialSelection].filter(
                        (entry) => entry !== gesture.entry,
                    ),
                );
            else if (!gesture.additive) this.#setSelection([gesture.entry]);
        } else if (
            gesture.kind === "dragging" &&
            gesture.hasMoved &&
            gesture.validDrop
        ) {
            this.#queue.MoveTracksBefore(gesture.entries, gesture.beforeEntry, gesture.intoHistory);
        }
    }

    #contentPosition(pointer: PointerPosition): PointerPosition {
        const bounds = this.#element.getBoundingClientRect();
        return {
            x: pointer.x - bounds.left + this.#element.scrollLeft,
            y: pointer.y - bounds.top + this.#element.scrollTop,
        };
    }

    /** The part of the list not covered by the bars above and below it, which the list's scroll padding records. */
    #visibleBounds() {
        const bounds = this.#element.getBoundingClientRect();
        const style = getComputedStyle(this.#element);
        return {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top + (parseFloat(style.scrollPaddingTop) || 0),
            bottom: bounds.bottom - (parseFloat(style.scrollPaddingBottom) || 0),
        };
    }

    #updateGesture() {
        const gesture = this.#gesture;
        if (gesture?.kind === "selecting") this.#updateDragSelection(gesture);
        else if (gesture?.kind === "dragging") this.#updateDrag(gesture);
    }

    /** Selects every row the pointer has swept past vertically since the gesture began. */
    #updateDragSelection(gesture: QueueGesture & { kind: "selecting" }) {
        const { rows } = this.#rowLayout();
        const pointer = this.#contentPosition(gesture.pointer);
        const top = Math.min(gesture.origin.y, pointer.y);
        const bottom = Math.max(gesture.origin.y, pointer.y);
        const entries = this.#queue.queue.filter((entry) => {
            const row = rows.get(entry.track.domElement!);
            return row && row.top <= bottom && row.bottom >= top;
        });
        this.#setSelection(
            gesture.additive
                ? [...gesture.initialSelection, ...entries]
                : entries,
        );
    }

    #updateDrag(gesture: QueueGesture & { kind: "dragging" }) {
        // Everything is read before the overlays are written to, so a frame lays the page out once.
        const { rows } = this.#rowLayout();
        const origin = this.#listOrigin();
        const bounds = this.#visibleBounds();
        const divider = this.#queue.HistoryDividerBounds;
        const { pointer, previewSize } = gesture;
        const previewLeft = snapToDevicePixel(
            Math.max(0, Math.min(pointer.x + 16, window.innerWidth - previewSize.width)),
        );
        const previewTop = snapToDevicePixel(
            Math.max(0, Math.min(pointer.y + 16, window.innerHeight - previewSize.height)),
        );
        const listWidth = this.#element.clientWidth;
        /** A row's bounds in the viewport. */
        const rowBounds = (entry: QueueTrackEntry | null | undefined) => {
            const row = entry?.track.domElement && rows.get(entry.track.domElement);
            return row && {
                left: row.left + origin.x,
                top: row.top + origin.y,
                right: row.right + origin.x,
                bottom: row.bottom + origin.y,
            };
        };

        this.#dragPreview.style.translate = `${previewLeft}px ${previewTop}px`;
        gesture.validDrop =
            pointer.x >= bounds.left &&
            pointer.x <= bounds.left + listWidth &&
            pointer.y >= bounds.top &&
            pointer.y <= bounds.bottom;
        if (!gesture.validDrop || !gesture.hasMoved) {
            this.#hideOverlay(this.#dropIndicator);
            return;
        }
        gesture.intoHistory =
            divider !== undefined &&
            pointer.y < divider.top + divider.height / 2;
        const remaining = this.#queue.queue.filter(
            (entry) =>
                !entry.track.isPlaying &&
                !gesture.dragged.has(entry) &&
                entry.order < this.#queue.HistoryLength === gesture.intoHistory,
        );
        gesture.beforeEntry =
            remaining.find((entry) => {
                const row = rowBounds(entry)!;
                return pointer.y < (row.top + row.bottom) / 2;
            }) ?? null;
        const beforeRow = rowBounds(gesture.beforeEntry);
        const lastRow = rowBounds(remaining.at(-1));
        const firstDraggedRow = rowBounds(gesture.entries[0])!;
        // An empty upcoming section still sits below the current track or the divider.
        const sectionTop = gesture.intoHistory
            ? undefined
            : (rowBounds(this.#queue.queue.find((entry) => entry.track.isPlaying)) ?? divider);
        const markerY = beforeRow
            ? beforeRow.top - 5
            : lastRow
              ? lastRow.bottom + 5
              : sectionTop
                ? sectionTop.bottom + 5
                : firstDraggedRow.top - 5;
        Object.assign(this.#dropIndicator.style, {
            left: `${firstDraggedRow.left}px`,
            width: `${firstDraggedRow.right - firstDraggedRow.left}px`,
            translate: `0 ${snapToDevicePixel(Math.max(bounds.top, Math.min(markerY, bounds.bottom - 3)))}px`,
        });
        this.#showOverlay(this.#dropIndicator);
    }

    /** Runs once a frame during a gesture: scrolls the list near its edges, then applies what changed. */
    #startGestureFrames() {
        let previousTimestamp: number | undefined;
        const frame = (timestamp: number) => {
            const gesture = this.#gesture;
            if (!gesture || gesture.kind === "pending") return;
            const seconds =
                previousTimestamp === undefined
                    ? 0
                    : Math.min(timestamp - previousTimestamp, 32) / 1000;
            previousTimestamp = timestamp;
            const bounds = this.#visibleBounds();
            if (
                gesture.pointer.x >= bounds.left &&
                gesture.pointer.x <= bounds.right
            ) {
                let speed = 0;
                if (gesture.pointer.y < bounds.top + scrollEdgePixels)
                    speed = -Math.min(
                        1,
                        (bounds.top + scrollEdgePixels - gesture.pointer.y) /
                            scrollEdgePixels,
                    );
                else if (gesture.pointer.y > bounds.bottom - scrollEdgePixels)
                    speed = Math.min(
                        1,
                        (gesture.pointer.y - bounds.bottom + scrollEdgePixels) /
                            scrollEdgePixels,
                    );
                if (speed) {
                    const previousScroll = this.#element.scrollTop;
                    this.#element.scrollTop +=
                        speed * scrollPixelsPerSecond * seconds;
                    if (this.#element.scrollTop !== previousScroll)
                        this.#gestureChanged = true;
                }
            }
            if (this.#gestureChanged) {
                this.#gestureChanged = false;
                this.#updateGesture();
            }
            this.#gestureFrame = requestAnimationFrame(frame);
        };
        this.#gestureFrame = requestAnimationFrame(frame);
    }

    #handleKey(event: KeyboardEvent) {
        if (event.key === "Escape") {
            if (this.#gesture) {
                const selection = this.#gesture.initialSelection;
                this.CancelGesture();
                this.#setSelection(selection);
            } else this.#setSelection([]);
            event.preventDefault();
        } else if (event.key === "Enter" && this.#focusedEntry) {
            this.CancelGesture();
            this.#queue.PlayOrToggleEntry(this.#focusedEntry);
            event.preventDefault();
        } else if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "a"
        ) {
            this.CancelGesture();
            this.#setSelection(this.#queue.queue);
            event.preventDefault();
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            this.CancelGesture();
            const selected = this.SelectedEntries;
            const current = this.#focusedEntry ?? selected.at(-1);
            const index = current ? this.#queue.queue.indexOf(current) : -1;
            const nextIndex = Math.max(
                0,
                Math.min(
                    this.#queue.queue.length - 1,
                    index + (event.key === "ArrowUp" ? -1 : 1),
                ),
            );
            const entry = this.#queue.queue[nextIndex];
            if (entry) {
                this.#setFocusedEntry(entry);
                if (event.shiftKey) this.#selectRange(entry, false);
                else {
                    this.#setSelection([entry]);
                    this.#selectionAnchor = entry;
                }
                entry.track.domElement?.scrollIntoView({ block: "nearest" });
            }
            event.preventDefault();
        }
    }
}
