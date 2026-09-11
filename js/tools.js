/**
 * Tool Definitions & Algorithmic Geometry Helpers (File Protocol Compatible)
 */

window.hexToRgba = function(hex, alpha = 0.4) {
  if (!hex) return `rgba(255, 214, 10, ${alpha})`;
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const r = parseInt(c.substring(0, 2), 16) || 0;
  const g = parseInt(c.substring(2, 4), 16) || 0;
  const b = parseInt(c.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

window.ToolState = {
  currentTool: 'pen', // 'pen', 'highlighter', 'pencil', 'eraser', 'shape', 'lasso', 'text', 'image', 'laser'
  penStyle: 'fountain', // 'fountain', 'ballpoint', 'brush'
  color: '#1C1C1E',
  size: 4, // stroke width
  opacity: 1.0,
  eraserMode: 'pixel', // 'pixel', 'object'
  eraserSize: 20,
  highlighterColor: 'rgba(255, 214, 10, 0.4)',
  highlighterHex: '#FFD60A',
  highlighterSize: 24,
  pencilColor: '#3A3A3C',
  pencilSize: 3,
  shapeType: 'auto',
  textFontSize: 18,
  textColor: '#1C1C1E'
};

// Spline smoothing interpolation for smooth natural handwriting
window.catmullRomSpline = function(points, samplesPerSegment = 6) {
  if (points.length < 3) return points;

  const result = [];
  result.push(points[0]);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < points.length - 2 ? points[i + 2] : p2;

    for (let t = 1; t <= samplesPerSegment; t++) {
      const u = t / samplesPerSegment;
      const u2 = u * u;
      const u3 = u2 * u;

      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * u +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3
      );

      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * u +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3
      );

      const pr1 = p1.pressure !== undefined ? p1.pressure : 0.5;
      const pr2 = p2.pressure !== undefined ? p2.pressure : 0.5;
      const pressure = pr1 + (pr2 - pr1) * u;

      result.push({ x, y, pressure });
    }
  }

  return result;
};

// Corner detection helper for polygon shape classification
window.findCornerPoints = function(points) {
  if (!points || points.length < 6) return [];
  const corners = [];
  const minAngle = 0.42; // Radians threshold for sharp directional turns

  for (let i = 2; i < points.length - 2; i += 2) {
    const pPrev = points[i - 2];
    const pCurr = points[i];
    const pNext = points[i + 2];

    const v1 = { x: pCurr.x - pPrev.x, y: pCurr.y - pPrev.y };
    const v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };

    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.hypot(v1.x, v1.y);
    const mag2 = Math.hypot(v2.x, v2.y);

    if (mag1 > 0 && mag2 > 0) {
      const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
      const angle = Math.acos(cosAngle);
      if (angle > minAngle) {
        if (corners.length === 0 || Math.hypot(pCurr.x - corners[corners.length - 1].x, pCurr.y - corners[corners.length - 1].y) > 14) {
          corners.push(pCurr);
        }
      }
    }
  }
  return corners;
};

// Function to classify triangle subtype: Right-Angled Triangle vs Equilateral Triangle vs General Triangle
window.classifyTriangle = function(p1, p2, p3) {
  const d12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const d23 = Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const d31 = Math.hypot(p1.x - p3.x, p1.y - p3.y);

  const angleAt = (A, V, B) => {
    const v1 = { x: A.x - V.x, y: A.y - V.y };
    const v2 = { x: B.x - V.x, y: B.y - V.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.hypot(v1.x, v1.y);
    const mag2 = Math.hypot(v2.x, v2.y);
    if (mag1 === 0 || mag2 === 0) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2)))) * (180 / Math.PI);
  };

  const a1 = angleAt(p2, p1, p3);
  const a2 = angleAt(p1, p2, p3);
  const a3 = angleAt(p1, p3, p2);

  // 1. Right-Angled Triangle (One angle near 90 degrees)
  if (Math.abs(a1 - 90) < 15) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    const side3Len = Math.hypot(p3.x - p1.x, p3.y - p1.y);
    const perpX = -dy / (len || 1), perpY = dx / (len || 1);
    const dot = (p3.x - p1.x) * perpX + (p3.y - p1.y) * perpY;
    const sign = dot >= 0 ? 1 : -1;
    return {
      type: 'triangle',
      p1: { x: p1.x, y: p1.y },
      p2: { x: p2.x, y: p2.y },
      p3: { x: p1.x + perpX * sign * side3Len, y: p1.y + perpY * sign * side3Len }
    };
  }

  if (Math.abs(a2 - 90) < 15) {
    const dx = p3.x - p2.x, dy = p3.y - p2.y;
    const len = Math.hypot(dx, dy);
    const side1Len = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    const perpX = -dy / (len || 1), perpY = dx / (len || 1);
    const dot = (p1.x - p2.x) * perpX + (p1.y - p2.y) * perpY;
    const sign = dot >= 0 ? 1 : -1;
    return {
      type: 'triangle',
      p1: { x: p2.x + perpX * sign * side1Len, y: p2.y + perpY * sign * side1Len },
      p2: { x: p2.x, y: p2.y },
      p3: { x: p3.x, y: p3.y }
    };
  }

  if (Math.abs(a3 - 90) < 15) {
    const dx = p1.x - p3.x, dy = p1.y - p3.y;
    const len = Math.hypot(dx, dy);
    const side2Len = Math.hypot(p2.x - p3.x, p2.y - p3.y);
    const perpX = -dy / (len || 1), perpY = dx / (len || 1);
    const dot = (p2.x - p3.x) * perpX + (p2.y - p3.y) * perpY;
    const sign = dot >= 0 ? 1 : -1;
    return {
      type: 'triangle',
      p1: { x: p1.x, y: p1.y },
      p2: { x: p3.x + perpX * sign * side2Len, y: p3.y + perpY * sign * side2Len },
      p3: { x: p3.x, y: p3.y }
    };
  }

  // 2. Equilateral Triangle (All sides equal within 20%)
  const avgLen = (d12 + d23 + d31) / 3;
  if (Math.abs(d12 - avgLen) / avgLen < 0.22 &&
      Math.abs(d23 - avgLen) / avgLen < 0.22 &&
      Math.abs(d31 - avgLen) / avgLen < 0.22) {
    const cx = (p1.x + p2.x + p3.x) / 3;
    const cy = (p1.y + p2.y + p3.y) / 3;
    const radius = avgLen / Math.sqrt(3);
    const initialAngle = Math.atan2(p1.y - cy, p1.x - cx);

    return {
      type: 'triangle',
      p1: { x: cx + radius * Math.cos(initialAngle), y: cy + radius * Math.sin(initialAngle) },
      p2: { x: cx + radius * Math.cos(initialAngle + (Math.PI * 2 / 3)), y: cy + radius * Math.sin(initialAngle + (Math.PI * 2 / 3)) },
      p3: { x: cx + radius * Math.cos(initialAngle + (Math.PI * 4 / 3)), y: cy + radius * Math.sin(initialAngle + (Math.PI * 4 / 3)) }
    };
  }

  return { type: 'triangle', p1, p2, p3 };
};

// Ramer-Douglas-Peucker (RDP) Curve Simplification for Vertex Identification
window.ramerDouglasPeucker = function(pts, epsilon) {
  if (!pts || pts.length < 3) return pts || [];
  let dmax = 0;
  let index = 0;
  const end = pts.length - 1;

  for (let i = 1; i < end; i++) {
    const dx = pts[end].x - pts[0].x;
    const dy = pts[end].y - pts[0].y;
    const mag = Math.hypot(dx, dy);
    let d = 0;
    if (mag === 0) {
      d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
    } else {
      d = Math.abs(dy * pts[i].x - dx * pts[i].y + pts[end].x * pts[0].y - pts[end].y * pts[0].x) / mag;
    }
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const res1 = window.ramerDouglasPeucker(pts.slice(0, index + 1), epsilon);
    const res2 = window.ramerDouglasPeucker(pts.slice(index), epsilon);
    return res1.slice(0, res1.length - 1).concat(res2);
  } else {
    return [pts[0], pts[end]];
  }
};

// High-Precision Shape Recognition (RDP Vertices + Triangle Protection)
window.detectShape = function(points) {
  if (!points || points.length < 3) return null;

  const start = points[0];
  const end = points[points.length - 1];
  const distStartEnd = Math.hypot(end.x - start.x, end.y - start.y);

  let totalLength = 0;
  let minX = points[0].x, maxX = points[0].x, minY = points[0].y, maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    totalLength += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    minX = Math.min(minX, points[i].x);
    maxX = Math.max(maxX, points[i].x);
    minY = Math.min(minY, points[i].y);
    maxY = Math.max(maxY, points[i].y);
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const diagonal = Math.hypot(width, height);

  // Check forced shape selection in ToolState
  const forcedMode = window.ToolState ? window.ToolState.shapeType : 'auto';

  if (forcedMode === 'line') {
    return { type: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }
  if (forcedMode === 'circle') {
    return { type: 'circle', cx: minX + width / 2, cy: minY + height / 2, r: (width + height) / 4 };
  }
  if (forcedMode === 'rectangle') {
    return { type: 'rectangle', x: minX, y: minY, w: width, h: height };
  }
  if (forcedMode === 'triangle') {
    const corners = window.findCornerPoints(points);
    if (corners.length >= 3) {
      return window.classifyTriangle(corners[0], corners[1], corners[2]);
    }
    // Fallback 3-point triangle from bounding box
    return window.classifyTriangle(
      { x: minX + width / 2, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    );
  }

  // ===== AUTO-DETECTION ENGINE =====

  // 1. OPEN PATH (Start & End far apart -> Straight Line!)
  if (distStartEnd > 70 || distStartEnd > totalLength * 0.32) {
    return { type: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }

  // 2. Ramer-Douglas-Peucker (RDP) Vertex Counting
  const epsilon = Math.max(9, diagonal * 0.085);
  const simplified = window.ramerDouglasPeucker(points, epsilon);

  // Unique vertices (remove close start/end duplicates)
  const vertices = [];
  for (let p of simplified) {
    if (vertices.length === 0 || Math.hypot(p.x - vertices[vertices.length - 1].x, p.y - vertices[vertices.length - 1].y) > 12) {
      vertices.push(p);
    }
  }
  if (vertices.length > 1 && Math.hypot(vertices[vertices.length - 1].x - vertices[0].x, vertices[vertices.length - 1].y - vertices[0].y) < 16) {
    vertices.pop();
  }

  const vertexCount = vertices.length;

  // 3. TRIANGLE DETECTION (3 Vertices via RDP or 3 sharp corner turns)
  const corners = window.findCornerPoints(points);

  if (vertexCount === 3 || corners.length === 3) {
    const pts = corners.length >= 3 ? corners : vertices;
    return window.classifyTriangle(pts[0], pts[1], pts[2]);
  }

  // 4. RECTANGLE / SQUARE DETECTION (4 Vertices via RDP or 4 sharp corners)
  if (vertexCount === 4 || corners.length >= 4) {
    return { type: 'rectangle', x: minX, y: minY, w: width, h: height };
  }

  // 5. CIRCLE / ELLIPSE TEST vs RECTANGLE (For high-vertex smooth curves)
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  const avgRadius = (width + height) / 4;

  let totalRadiusDev = 0;
  for (let i = 0; i < points.length; i += 3) {
    const dist = Math.hypot(points[i].x - cx, points[i].y - cy);
    totalRadiusDev += Math.abs(dist - avgRadius);
  }
  const avgDevRatio = (totalRadiusDev / (points.length / 3)) / (avgRadius || 1);

  // If stroke has low variance from center -> Genuine CIRCLE!
  if (avgDevRatio < 0.22 && vertexCount > 4) {
    return { type: 'circle', cx, cy, r: avgRadius };
  }

  // 6. DEFAULT FALLBACK BASED ON VERTICES / ASPECT
  if (vertexCount <= 3) {
    const pts = vertices.length >= 3 ? vertices : [
      { x: minX + width / 2, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ];
    return window.classifyTriangle(pts[0], pts[1], pts[2]);
  }

  return { type: 'rectangle', x: minX, y: minY, w: width, h: height };
};


// Point-in-polygon test for Lasso
window.isPointInPolygon = function(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// Check if stroke intersects lasso
window.isStrokeInLasso = function(stroke, lassoPoints) {
  if (!stroke.points || stroke.points.length === 0) return false;
  const step = Math.max(1, Math.min(3, Math.floor(stroke.points.length / 80)));
  for (let i = 0; i < stroke.points.length; i += step) {
    if (window.isPointInPolygon(stroke.points[i], lassoPoints)) return true;
  }
  return false;
};
