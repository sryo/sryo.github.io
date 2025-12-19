// ========================================
// Portfolio Interactions
// ========================================

const checkboxButtons = document.querySelectorAll('input[type="checkbox"]');
const items = document.querySelectorAll(".item");
const galleries = document.querySelectorAll(".gallery");
const svg = document.getElementById("lineContainer");

// --- Configuration ---
const MAX_PATHS = 10;
const LINE_COLORS = [
    "#E7A545", "#FFC0CB", "#E94136",
    "#7E3972", "#1E88E5", "#414DA1", "#007A44"
];

// --- State ---
let currentPaths = [];
let currentColorIndex = 0;
let lastHoveredItem = items[0];

// --- Gallery Management ---
function closeAllGalleries() {
    checkboxButtons.forEach(cb => cb.checked = false);
    galleries.forEach(g => g.classList.remove("active"));
}

function openGallery(itemId) {
    const gallery = document.querySelector(`.gallery[data-for="${itemId}"]`);
    if (gallery) {
        const children = [...gallery.children];
        children.forEach(child => child.style.animation = "none");
        gallery.offsetHeight; // force reflow
        children.forEach((child, i) => {
            child.style.animation = "";
            child.style.setProperty("--i", i);
        });
        gallery.classList.add("active");
    }
}

// Handle checkbox changes
checkboxButtons.forEach(checkbox => {
    checkbox.addEventListener("change", function() {
        // Close all galleries first
        galleries.forEach(g => g.classList.remove("active"));

        if (this.checked) {
            // Uncheck other checkboxes
            checkboxButtons.forEach(cb => {
                if (cb !== this) cb.checked = false;
            });
            // Open corresponding gallery
            openGallery(this.id);
        }

        updateHistory(this);
    });
});

// Click on back button area closes gallery
galleries.forEach(gallery => {
    gallery.addEventListener("click", function(e) {
        // Only close if clicking the top-left back button area
        if (e.clientX < 150 && e.clientY < 80) {
            closeAllGalleries();
        }
    });
});

// --- Keyboard Navigation ---
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeAllGalleries();
        return;
    }

    const focusedItem = document.activeElement?.closest(".item");
    if (!focusedItem) return;

    const itemsArray = [...items];
    const currentIndex = itemsArray.indexOf(focusedItem);

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = (currentIndex + 1) % itemsArray.length;
        itemsArray[nextIndex].querySelector("input").focus();
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        const prevIndex = (currentIndex - 1 + itemsArray.length) % itemsArray.length;
        itemsArray[prevIndex].querySelector("input").focus();
    }
});

// --- URL History ---
function updateHistory(checkbox) {
    const url = new URL(window.location.href);
    if (checkbox.checked) {
        url.searchParams.set("view", checkbox.id);
    } else {
        url.searchParams.delete("view");
    }
    window.history.pushState({ checkboxId: checkbox.id, checked: checkbox.checked }, "", url);
}

window.addEventListener("popstate", closeAllGalleries);

// --- SVG Line Drawing ---
function getNextColor() {
    const color = LINE_COLORS[currentColorIndex];
    currentColorIndex = (currentColorIndex + 1) % LINE_COLORS.length;
    return color;
}

function drawConnector(startEl, endEl) {
    const rect1 = startEl.getBoundingClientRect();
    const rect2 = endEl.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();

    const startX = rect1.left + rect1.width / 2 - svgRect.left;
    const startY = rect1.top + rect1.height / 2 - svgRect.top;
    const endX = rect2.left + rect2.width / 2 - svgRect.left;
    const endY = rect2.top + rect2.height / 2 - svgRect.top;

    const maxCornerRadius = 80;
    const distX = Math.abs(endX - startX);
    const distY = Math.abs(endY - startY);
    const isHorizontalFirst = distX > distY;
    const cornerRadius = Math.min(maxCornerRadius, isHorizontalFirst ? distY / 2 : distX / 2);
    const directionX = endX > startX ? 1 : -1;
    const directionY = endY > startY ? 1 : -1;

    let pathData;

    if (isHorizontalFirst) {
        const midX = (startX + endX) / 2;
        if (distY < 2 * cornerRadius) {
            pathData = `M${startX},${startY} H${midX} L${endX},${endY}`;
        } else {
            const sweepFlag1 = directionX * directionY > 0 ? 1 : 0;
            const sweepFlag2 = directionX * directionY > 0 ? 0 : 1;
            pathData = `M${startX},${startY}
                H${midX - directionX * cornerRadius}
                A${cornerRadius},${cornerRadius} 0 0 ${sweepFlag1} ${midX},${startY + directionY * cornerRadius}
                V${endY - directionY * cornerRadius}
                A${cornerRadius},${cornerRadius} 0 0 ${sweepFlag2} ${midX + directionX * cornerRadius},${endY}
                H${endX}`;
        }
    } else {
        const midY = (startY + endY) / 2;
        if (distX < 2 * cornerRadius) {
            pathData = `M${startX},${startY} V${midY} L${endX},${endY}`;
        } else {
            const sweepFlag1 = directionX * directionY < 0 ? 1 : 0;
            const sweepFlag2 = directionX * directionY < 0 ? 0 : 1;
            pathData = `M${startX},${startY}
                V${midY - directionY * cornerRadius}
                A${cornerRadius},${cornerRadius} 0 0 ${sweepFlag1} ${startX + directionX * cornerRadius},${midY}
                H${endX - directionX * cornerRadius}
                A${cornerRadius},${cornerRadius} 0 0 ${sweepFlag2} ${endX},${midY + directionY * cornerRadius}
                V${endY}`;
        }
    }

    const connector = document.createElementNS("http://www.w3.org/2000/svg", "path");
    connector.setAttribute("d", pathData);
    connector.setAttribute("stroke", getNextColor());
    connector.setAttribute("fill", "none");

    const length = connector.getTotalLength();
    connector.style.setProperty("--length", length);

    svg.appendChild(connector);
    currentPaths.push(connector);

    if (currentPaths.length > MAX_PATHS) {
        const oldestPath = currentPaths.shift();
        oldestPath.classList.add("fade-out");
        setTimeout(() => oldestPath.remove(), 300);
    }
}

items.forEach((item) => {
    item.addEventListener("mouseenter", (e) => {
        if (!lastHoveredItem) {
            lastHoveredItem = e.target;
            return;
        }
        if (lastHoveredItem !== e.target) {
            drawConnector(lastHoveredItem, e.target);
            lastHoveredItem = e.target;
        }
    });
});

// --- Layout: Radial Positioning ---
function layoutItems(stagger = false) {
    const itemCount = items.length;
    const radius = Math.min(window.innerWidth, window.innerHeight) * 0.35;
    const startAngle = -Math.PI / 2;

    items.forEach((item, index) => {
        const angle = startAngle + (2 * Math.PI * index) / itemCount;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;

        if (stagger) {
            item.style.transitionDelay = `${index * 50}ms`;
            setTimeout(() => item.style.transitionDelay = "0ms", 600 + index * 50);
        }
        item.style.translate = `${x}px ${y}px`;
        item.classList.add("visible");
    });
}

// --- Debounce ---
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// --- Resize Handler ---
window.addEventListener("resize", debounce(() => {
    if (svg) {
        currentPaths.forEach(path => svg.removeChild(path));
        currentPaths = [];
    }
    lastHoveredItem = null;
    layoutItems();
}, 250));

// --- Initialize ---
layoutItems(true);

// Restore from URL
const params = new URLSearchParams(window.location.search);
const viewParam = params.get("view");
if (viewParam) {
    const checkbox = document.getElementById(viewParam);
    if (checkbox) {
        checkbox.checked = true;
        openGallery(viewParam);
    }
}
