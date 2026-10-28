import type { QueueManager } from "./QueueManager";
import type { QueueTrackEntry } from "./QueueTrackEntry";
import { queueMotion, reducedQueueMotion } from "./QueueMotion";

const dragHoldMilliseconds = 200;
const pointerTolerancePixels = 10;
const scrollEdgePixels = 48;
const scrollPixelsPerSecond = 700;

interface PointerPosition {
    x: number;
    y: number;
}

interface SelectionGroup {
    left: number;
    top: number;
    right: number;
    bottom: number;
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
              beforeEntry: QueueTrackEntry | null;
              hasMoved: boolean;
              validDrop: boolean;
          }
    );

export class QueueInteraction {
    #element: HTMLElement;
    #queue: QueueManager;
    #selected = new Set<QueueTrackEntry>();
    #selectionAnchor: QueueTrackEntry | undefined;
    #focusedEntry: QueueTrackEntry | undefined;
    #nextOptionId = 0;
    #gesture: QueueGesture | undefined;
    #holdTimer: number | undefined;
    #scrollFrame: number | undefined;
    #selectionFrame: number | undefined;
    #selectionBox = document.createElement("div");
    #dropIndicator = document.createElement("div");
    #dragPreview = document.createElement("div");
    #selectionHighlights: SelectionHighlight[] = [];
    #selectionMerges = new Map<HTMLElement, Animation>();
    #overlayAnimations = new Map<HTMLElement, Animation>();
    #selectionResizeObserver = new ResizeObserver(() =>
        this.#renderSelectionHighlights(),
    );

    constructor(element: HTMLElement, queue: QueueManager) {
        this.#element = element;
        this.#queue = queue;
        this.#selectionBox.className = "queueSelectionBox";
        this.#dropIndicator.className = "queueDropIndicator";
        this.#dragPreview.className = "queueDragPreview";
        for (const overlay of [
            this.#selectionBox,
            this.#dropIndicator,
            this.#dragPreview,
        ])
            overlay.setAttribute("aria-hidden", "true");
    }

    Initialize() {
        this.#element.setAttribute("role", "listbox");
        this.#element.setAttribute("aria-label", "Queue");
        this.#element.setAttribute("aria-multiselectable", "true");
        this.#element.tabIndex = 0;
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
        this.#element.addEventListener("scroll", () => this.#updateGesture());
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
        reducedQueueMotion.addEventListener("change", () => {
            if (!reducedQueueMotion.matches) return;
            for (const animation of this.#overlayAnimations.values())
                animation.finish();
            for (const animation of this.#selectionMerges.values())
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
        this.CancelGesture();
        this.#scheduleSelectionHighlights();
    }

    QueueChanged() {
        this.CancelGesture();
        this.#setSelection(this.SelectedEntries);
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
        if (this.#scrollFrame !== undefined)
            cancelAnimationFrame(this.#scrollFrame);
        this.#scrollFrame = undefined;
        this.#hideOverlay(this.#selectionBox);
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

    #showOverlay(element: HTMLElement, parent: HTMLElement = document.body) {
        if (element.isConnected && element.dataset.exiting !== "true") return;
        const opacity = element.isConnected ? getComputedStyle(element).opacity : "0";
        this.#overlayAnimations.get(element)?.cancel();
        this.#overlayAnimations.delete(element);
        delete element.dataset.exiting;
        parent.appendChild(element);
        if (reducedQueueMotion.matches) return;
        const animation = element.animate(
            [{ opacity }, { opacity: getComputedStyle(element).opacity }],
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
        if (reducedQueueMotion.matches) {
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

    #setSelection(entries: Iterable<QueueTrackEntry>) {
        const requested = new Set(entries);
        const selected = new Set(
            this.#queue.queue.filter((entry) => requested.has(entry)),
        );
        const selectionChanged =
            selected.size !== this.#selected.size ||
            [...selected].some((entry) => !this.#selected.has(entry));
        for (const entry of new Set([...this.#selected, ...selected])) {
            const isSelected = selected.has(entry);
            if (this.#selected.has(entry) === isSelected) continue;
            entry.track.domElement?.setAttribute(
                "data-selected",
                String(isSelected),
            );
            entry.track.domElement?.setAttribute(
                "aria-selected",
                String(isSelected),
            );
        }
        this.#selected = selected;
        if (selectionChanged) {
            this.#selectionResizeObserver.disconnect();
            this.#selectionResizeObserver.observe(this.#element);
            for (const entry of selected)
                if (entry.track.domElement)
                    this.#selectionResizeObserver.observe(
                        entry.track.domElement,
                    );
        }
        this.#renderSelectionHighlights();
    }

    #scheduleSelectionHighlights() {
        if (!this.#selected.size || this.#selectionFrame !== undefined) return;
        this.#selectionFrame = requestAnimationFrame(() => {
            this.#selectionFrame = undefined;
            this.#renderSelectionHighlights();
        });
    }

    #renderSelectionHighlights() {
        if (this.#selectionFrame !== undefined)
            cancelAnimationFrame(this.#selectionFrame);
        this.#selectionFrame = undefined;
        const groups: SelectionGroup[] = [];
        let group: SelectionGroup | undefined;
        if (this.#selected.size) {
            const rows = this.#queue.queue
                .flatMap((entry) => {
                    const element = entry.track.domElement;
                    return element
                        ? [{ entry, element, bounds: element.getBoundingClientRect() }]
                        : [];
                })
                .sort((a, b) => a.bounds.top - b.bounds.top);
            for (const { entry, element, bounds } of rows) {
                if (!this.#selected.has(entry)) {
                    group = undefined;
                    continue;
                }
                const dragging = element.dataset.dragging === "true";
                const moving = element.getAnimations().some((animation) =>
                    animation.playState === "running" &&
                    animation.effect instanceof KeyframeEffect &&
                    animation.effect.getKeyframes().some((frame) => "translate" in frame || "transform" in frame),
                );
                if (!group || group.dragging !== dragging || bounds.top > group.bottom + 11) {
                    group = {
                        left: bounds.left,
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        dragging,
                        moving,
                        entries: new Set([entry]),
                    };
                    groups.push(group);
                } else {
                    group.left = Math.min(group.left, bounds.left);
                    group.right = Math.max(group.right, bounds.right);
                    group.bottom = Math.max(group.bottom, bounds.bottom);
                    group.moving ||= moving;
                    group.entries.add(entry);
                }
            }
        }
        const previousHighlights = this.#selectionHighlights.map((highlight) => ({
            highlight,
            bounds: highlight.element.getBoundingClientRect(),
        }));
        const unusedHighlights = new Set(this.#selectionHighlights);
        this.#selectionHighlights = [];
        const bounds = this.#element.getBoundingClientRect();
        let animating = false;
        for (const group of groups) {
            const matching = previousHighlights.filter(({ highlight }) =>
                unusedHighlights.has(highlight) &&
                [...group.entries].some((entry) => highlight.entries.has(entry)),
            );
            let selection = matching[0]?.highlight;
            if (!selection) {
                const element = document.createElement("div");
                element.className = "queueSelectionHighlight";
                element.setAttribute("aria-hidden", "true");
                selection = { element, entries: group.entries };
            }
            const highlight = selection.element;
            if (group.moving || selection.entries.size !== group.entries.size ||
                [...group.entries].some((entry) => !selection.entries.has(entry)))
                this.#cancelSelectionMerge(highlight);
            for (const { highlight: previous } of matching) {
                unusedHighlights.delete(previous);
                if (previous === selection) continue;
                this.#cancelSelectionMerge(previous.element);
                this.#overlayAnimations.get(previous.element)?.cancel();
                this.#overlayAnimations.delete(previous.element);
                previous.element.remove();
            }
            selection.entries = group.entries;
            this.#selectionHighlights.push(selection);
            const merging = matching.length > 1 && !group.moving && !reducedQueueMotion.matches;
            if (merging) highlight.dataset.merging = "true";
            animating ||= group.moving;
            highlight.dataset.dragging = String(group.dragging);
            highlight.dataset.moving = String(group.moving);
            Object.assign(highlight.style, {
                left: `${group.left - bounds.left + this.#element.scrollLeft}px`,
                top: `${group.top - bounds.top + this.#element.scrollTop}px`,
                width: `${group.right - group.left}px`,
                height: `${group.bottom - group.top}px`,
            });
            if (merging)
                this.#animateSelectionMerge(highlight, matching.map(({ bounds }) => bounds), group);
            this.#showOverlay(highlight, this.#element);
        }
        for (const { element } of unusedHighlights) {
            this.#cancelSelectionMerge(element);
            this.#hideOverlay(element);
        }
        if (animating) this.#scheduleSelectionHighlights();
    }

    #cancelSelectionMerge(element: HTMLElement) {
        this.#selectionMerges.get(element)?.cancel();
        this.#selectionMerges.delete(element);
        delete element.dataset.merging;
    }

    #animateSelectionMerge(element: HTMLElement, previous: DOMRect[], group: SelectionGroup) {
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
            { duration: 200, easing: "cubic-bezier(0, 0.78, 0.17, 1)" },
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
            this.#gesture
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
                (entry) => entry.order >= this.#queue.GetFirstSafeQueueIndex(),
            ) ?? selectedGroup.entries.values().next().value;
        const additive = event.ctrlKey || event.metaKey;
        const initialSelection = new Set(this.#selected);

        if (!startedInSelectionGap) {
            if (entry && event.shiftKey) this.#selectRange(entry, additive);
            else if (entry && !this.#selected.has(entry))
                this.#setSelection(additive ? [...this.#selected, entry] : [entry]);
            else if (!entry && !additive) this.#setSelection([]);
        }
        if (entry && !event.shiftKey && !startedInSelectionGap) this.#selectionAnchor = entry;
        this.#setFocusedEntry(entry);

        const pointer = { x: event.clientX, y: event.clientY };
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
            origin: this.#contentPosition(pointer),
        };
        this.#gesture = gesture;
        this.#element.focus({ preventScroll: true });
        this.#element.setPointerCapture(event.pointerId);
        if (entry && entry.order >= this.#queue.GetFirstSafeQueueIndex()) {
            this.#holdTimer = window.setTimeout(() => {
                if (this.#gesture !== gesture) return;
                const entries = this.SelectedEntries.filter(
                    (entry) =>
                        entry.order >= this.#queue.GetFirstSafeQueueIndex(),
                );
                if (!entries.length) return;
                this.#gesture = {
                    ...gesture,
                    kind: "dragging",
                    entries,
                    beforeEntry: null,
                    hasMoved: false,
                    validDrop: false,
                };
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
                this.#updateGesture();
                this.#startAutoScroll();
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
            this.#startAutoScroll();
        } else if (
            gesture.kind === "dragging" &&
            distance > pointerTolerancePixels
        ) {
            gesture.hasMoved = true;
        }
        this.#updateGesture();
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
            this.#queue.MoveTracksBefore(gesture.entries, gesture.beforeEntry);
        }
    }

    #contentPosition(pointer: PointerPosition): PointerPosition {
        const bounds = this.#element.getBoundingClientRect();
        return {
            x: pointer.x - bounds.left + this.#element.scrollLeft,
            y: pointer.y - bounds.top + this.#element.scrollTop,
        };
    }

    #updateGesture() {
        const gesture = this.#gesture;
        if (gesture?.kind === "selecting") this.#updateBoxSelection(gesture);
        else if (gesture?.kind === "dragging") this.#updateDrag(gesture);
    }

    #updateBoxSelection(gesture: QueueGesture & { kind: "selecting" }) {
        const pointer = this.#contentPosition(gesture.pointer);
        const left = Math.min(gesture.origin.x, pointer.x);
        const right = Math.max(gesture.origin.x, pointer.x);
        const top = Math.min(gesture.origin.y, pointer.y);
        const bottom = Math.max(gesture.origin.y, pointer.y);
        const bounds = this.#element.getBoundingClientRect();
        const entries = this.#queue.queue.filter((entry) => {
            const row = entry.track.domElement!.getBoundingClientRect();
            const rowLeft = row.left - bounds.left + this.#element.scrollLeft;
            const rowTop = row.top - bounds.top + this.#element.scrollTop;
            return (
                rowLeft <= right &&
                rowLeft + row.width >= left &&
                rowTop <= bottom &&
                rowTop + row.height >= top
            );
        });
        this.#setSelection(
            gesture.additive
                ? [...gesture.initialSelection, ...entries]
                : entries,
        );
        const visibleLeft = Math.max(
            bounds.left,
            bounds.left + left - this.#element.scrollLeft,
        );
        const visibleTop = Math.max(
            bounds.top,
            bounds.top + top - this.#element.scrollTop,
        );
        const visibleRight = Math.min(
            bounds.left + this.#element.clientWidth,
            bounds.left + right - this.#element.scrollLeft,
        );
        const visibleBottom = Math.min(
            bounds.bottom,
            bounds.top + bottom - this.#element.scrollTop,
        );
        Object.assign(this.#selectionBox.style, {
            left: `${visibleLeft}px`,
            top: `${visibleTop}px`,
            width: `${Math.max(1, visibleRight - visibleLeft)}px`,
            height: `${Math.max(1, visibleBottom - visibleTop)}px`,
        });
        this.#showOverlay(this.#selectionBox);
    }

    #updateDrag(gesture: QueueGesture & { kind: "dragging" }) {
        Object.assign(this.#dragPreview.style, {
            left: `${Math.max(0, Math.min(gesture.pointer.x + 16, window.innerWidth - this.#dragPreview.offsetWidth))}px`,
            top: `${Math.max(0, Math.min(gesture.pointer.y + 16, window.innerHeight - this.#dragPreview.offsetHeight))}px`,
        });
        const bounds = this.#element.getBoundingClientRect();
        gesture.validDrop =
            gesture.pointer.x >= bounds.left &&
            gesture.pointer.x <= bounds.left + this.#element.clientWidth &&
            gesture.pointer.y >= bounds.top &&
            gesture.pointer.y <= bounds.bottom;
        if (!gesture.validDrop || !gesture.hasMoved) {
            this.#hideOverlay(this.#dropIndicator);
            return;
        }
        const dragged = new Set(gesture.entries);
        const remaining = this.#queue.queue.filter(
            (entry) =>
                entry.order >= this.#queue.GetFirstSafeQueueIndex() &&
                !dragged.has(entry),
        );
        gesture.beforeEntry =
            remaining.find((entry) => {
                const row = entry.track.domElement!.getBoundingClientRect();
                return gesture.pointer.y < row.top + row.height / 2;
            }) ?? null;
        const beforeRow =
            gesture.beforeEntry?.track.domElement?.getBoundingClientRect();
        const lastRow = remaining
            .at(-1)
            ?.track.domElement?.getBoundingClientRect();
        const firstDraggedRow =
            gesture.entries[0].track.domElement!.getBoundingClientRect();
        const markerY = beforeRow
            ? beforeRow.top - 5
            : lastRow
              ? lastRow.bottom + 5
              : firstDraggedRow.top - 5;
        Object.assign(this.#dropIndicator.style, {
            left: `${firstDraggedRow.left}px`,
            width: `${firstDraggedRow.width}px`,
            top: `${Math.max(bounds.top, Math.min(markerY, bounds.bottom - 3))}px`,
        });
        this.#showOverlay(this.#dropIndicator);
    }

    #startAutoScroll() {
        let previousTimestamp: number | undefined;
        const scroll = (timestamp: number) => {
            const gesture = this.#gesture;
            if (!gesture || gesture.kind === "pending") return;
            const seconds =
                previousTimestamp === undefined
                    ? 0
                    : Math.min(timestamp - previousTimestamp, 32) / 1000;
            previousTimestamp = timestamp;
            const bounds = this.#element.getBoundingClientRect();
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
                const previousScroll = this.#element.scrollTop;
                this.#element.scrollTop +=
                    speed * scrollPixelsPerSecond * seconds;
                if (this.#element.scrollTop !== previousScroll)
                    this.#updateGesture();
            }
            this.#scrollFrame = requestAnimationFrame(scroll);
        };
        this.#scrollFrame = requestAnimationFrame(scroll);
    }

    #handleKey(event: KeyboardEvent) {
        if (event.key === "Escape") {
            if (this.#gesture) {
                const selection = this.#gesture.initialSelection;
                this.CancelGesture();
                this.#setSelection(selection);
            } else this.#setSelection([]);
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
