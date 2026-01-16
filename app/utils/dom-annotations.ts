
/**
 * A lightweight utility to serialize DOM ranges and highlight them.
 * 
 * Strategy:
 * We identify nodes by their "child path" from a root container.
 * A path is an array of indices: [0, 2, 0] means root.childNodes[0].childNodes[2].childNodes[0].
 */

export interface SerializedRange {
    startPath: number[];
    startOffset: number;
    endPath: number[];
    endOffset: number;
    text: string; // for verification/search
}

/**
 * Gets the path of indices from the root element to the target node.
 */
function getNodePath(node: Node, root: Node): number[] {
    const path: number[] = [];
    let current = node;

    while (current !== root) {
        const parent = current.parentNode;
        if (!parent) {
            console.error("Node is not a descendant of root", node);
            return []; // Detached or not in root
        }

        // Find index of current node in parent's childNodes
        // We use all child nodes (including text) to be precise
        const index = Array.from(parent.childNodes).indexOf(current as ChildNode);
        path.unshift(index);
        current = parent;
    }
    return path;
}

/**
 * Finds a node from a path of indices starting at root.
 */
function getNodeFromPath(path: number[], root: Node): Node | null {
    let current = root;
    for (const index of path) {
        if (!current.childNodes || !current.childNodes[index]) {
            return null; // Path invalid (DOM changed?)
        }
        current = current.childNodes[index];
    }
    return current;
}

/**
 * Serializes a DOM Range object relative to a root container.
 */
export function serializeRange(range: Range, root: HTMLElement): SerializedRange | null {
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
        console.warn("Selection is outside the content area.");
        return null;
    }

    return {
        startPath: getNodePath(range.startContainer, root),
        startOffset: range.startOffset,
        endPath: getNodePath(range.endContainer, root),
        endOffset: range.endOffset,
        text: range.toString()
    };
}

/**
 * Deserializes a SerializedRange back into a DOM Range object.
 */
export function deserializeRange(data: SerializedRange, root: HTMLElement): Range | null {
    const startNode = getNodeFromPath(data.startPath, root);
    const endNode = getNodeFromPath(data.endPath, root);

    if (!startNode || !endNode) {
        // console.warn("deserializeRange: Could not locate nodes.", {
        //     data,
        //     root,
        //     foundStart: !!startNode,
        //     foundEnd: !!endNode
        // });
        return null;
    }

    try {
        const range = document.createRange();
        range.setStart(startNode, data.startOffset);
        range.setEnd(endNode, data.endOffset);
        return range;
    } catch (e) {
        console.error("deserializeRange: Failed to set range endpoints", e);
        return null;
    }
}

/**
 * Wraps a range in a highlight element (<mark>).
 * Note: This modifies the DOM and invalidates existing ranges/paths if they cross this boundary.
 * Use with caution or re-serialize immediately if needed (though we typically load stored annotations once).
 * 
 * For complex ranges spanning multiple block elements, this is tricky.
 * A simple robust approach for MVP:
 * 1. Use the `Range.extractContents()` -> wrap -> insert approach? No, that breaks event listeners.
 * 2. `Range.surroundContents()` works only if the range includes entire non-text nodes.
 * 
 * Better approach for text highlighting:
 * Iterate text nodes in the range and wrap them individually.
 */
export function highlightRange(range: Range, id: string, color: string = "#fef9c3"): HTMLElement[] {
    const highlights: HTMLElement[] = [];
    const iterator = document.createNodeIterator(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                // Check if node is at least partially in the range
                return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        }
    );

    let node;
    const nodesToWrap: { node: Node, start: number, end: number }[] = [];

    while (node = iterator.nextNode()) {
        const start = (node === range.startContainer) ? range.startOffset : 0;
        const end = (node === range.endContainer) ? range.endOffset : (node.textContent?.length || 0);

        // Skip empty wraps
        if (start < end) {
            nodesToWrap.push({ node, start, end });
        }
    }

    // Now apply wraps. We do this after collecting to avoid messing up the iterator dealing with live DOM
    nodesToWrap.forEach(({ node, start, end }) => {
        const span = document.createElement("mark");
        span.dataset.annotationId = id;
        span.style.backgroundColor = color;
        span.style.cursor = "pointer";
        span.className = "annotation-highlight";

        const rangePart = document.createRange();
        rangePart.setStart(node, start);
        rangePart.setEnd(node, end);

        try {
            rangePart.surroundContents(span);
            highlights.push(span);
        } catch (e) {
            console.warn("Could not wrap node", node, e);
            // Fallback for complex nesting if surroundContents fails (uncommon in simple text)
        }
    });

    return highlights;
}
