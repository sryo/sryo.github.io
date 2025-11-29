const checkboxButtons = document.querySelectorAll('input[type="checkbox"]');
const svg = document.getElementById("lineContainer");
const MAX_PATHS = 10;
let currentPaths = [];
const clearCheckedCheckboxButtons = () => {
  checkboxButtons.forEach((checkboxButton) => {
    checkboxButton.checked = false;
  });
};
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape" || event.keyCode === 27) {
    clearCheckedCheckboxButtons();
  }
});

function updateHistory(checkbox) {
  let url = new URL(window.location.href);
  if (checkbox.checked) {
    url.searchParams.set(checkbox.name, checkbox.id);
  } else {
    url.searchParams.delete(checkbox.name);
  }
  window.history.pushState(
    {
      checkboxId: checkbox.id,
      checked: checkbox.checked,
    },
    "",
    url,
  );
}
checkboxButtons.forEach((checkbox) => {
  checkbox.addEventListener("change", function () {
    updateHistory(this);
  });
});
window.addEventListener("popstate", clearCheckedCheckboxButtons);
const lineColors = [
  "#E7A545",
  "#FFC0CB",
  "#E94136",
  "#7E3972",
  "#1E88E5",
  "#414DA1",
  "#007A44",
];
let currentColorIndex = 0;

function getNextColor() {
  const color = lineColors[currentColorIndex];
  currentColorIndex = (currentColorIndex + 1) % lineColors.length;
  return color;
}
const items = document.querySelectorAll(".item");
const cellWidth = 137;
const cellHeight = 120;

function layoutItems() {
  const numCols = Math.max(1, Math.floor((window.innerWidth - 100) / cellWidth));
  const numRows = Math.max(1, Math.floor((window.innerHeight - 100) / cellHeight));
  const isCellOccupied = Array(numRows)
    .fill(null)
    .map(() => Array(numCols).fill(false));
  const maxAttempts = 100;

  items.forEach((item, index) => {
    item.style.setProperty("--stagger", index);
    let attempts = 0;
    let x, y;
    while (attempts < maxAttempts) {
      x = Math.floor(Math.random() * numCols);
      y = Math.floor(Math.random() * numRows);
      const iconWidth = item.clientWidth;
      const iconHeight = item.clientHeight;
      
      // Ensure we don't go out of bounds (simplified check)
      if (x >= numCols || y >= numRows) {
          attempts++;
          continue;
      }

      const iconRightEdge = x * cellWidth + 50 + cellWidth - iconWidth;
      const iconBottomEdge = y * cellHeight + 50 + cellHeight - iconHeight;
      
      if (
        iconRightEdge > window.innerWidth ||
        iconBottomEdge > window.innerHeight
      ) {
        attempts++;
        continue;
      }
      
      if (isCellOccupied[y][x]) {
        attempts++;
        continue;
      }
      
      isCellOccupied[y][x] = true;
      item.style.left = `${((50 + x * cellWidth + Math.random() * (cellWidth - iconWidth)) / window.innerWidth) * 100}%`;
      item.style.top = `${((50 + y * cellHeight + Math.random() * (cellHeight - iconHeight)) / window.innerHeight) * 100}%`;
      break;
    }
  });
}

// Initial layout
layoutItems();

let lastHoveredItem = items[0];
items.forEach((item) => {
  item.addEventListener("mouseenter", (e) => {
    if (!lastHoveredItem) {
      lastHoveredItem = e.target;
      return;
    }
    if (lastHoveredItem !== e.target) {
      const rect1 = lastHoveredItem.getBoundingClientRect();
      const rect2 = e.target.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const startX = rect1.left + rect1.width / 2 - svgRect.left;
      const startY = rect1.top + rect1.height / 2 - svgRect.top;
      const endX = rect2.left + rect2.width / 2 - svgRect.left;
      const endY = rect2.top + rect2.height / 2 - svgRect.top;
      const maxCornerRadius = 80; // Maximum corner radius
      let pathData;
      const distX = Math.abs(endX - startX);
      const distY = Math.abs(endY - startY);
      const isHorizontalFirst = distX > distY;
      // Dynamically adjust corner radius
      const cornerRadius = Math.min(
        maxCornerRadius,
        isHorizontalFirst ? distY / 2 : distX / 2,
      );
      const directionX = endX > startX ? 1 : -1;
      const directionY = endY > startY ? 1 : -1;
      if (isHorizontalFirst) {
        const midX = (startX + endX) / 2;
        if (distY < 2 * cornerRadius) {
          // Simplified path for small vertical distances
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
          // Simplified path for small horizontal distances
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
      const connector = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      connector.setAttribute("d", pathData);
      connector.setAttribute("stroke", getNextColor());
      connector.setAttribute("fill", "none");
      const length = connector.getTotalLength();
      connector.setAttribute("style", `--length: ${length};`);
      svg.appendChild(connector);
      currentPaths.push(connector);
      if (currentPaths.length > MAX_PATHS) {
        const oldestPath = currentPaths.shift();
        svg.removeChild(oldestPath);
      }
      lastHoveredItem = e.target;
    }
  });
});

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

window.addEventListener(
  "resize",
  debounce(() => {
    if (svg) {
        currentPaths.forEach((path) => svg.removeChild(path));
        currentPaths = [];
    }
    lastHoveredItem = null;
    layoutItems();
  }, 250),
);
