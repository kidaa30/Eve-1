//---------------------------------------------------------
// Globals
//---------------------------------------------------------

var toolbarOffset = 50;
var ixer = new Indexing.Indexer();
var grid;
var client = localStorage["client"] || uuid();
localStorage["client"] = client;

//@HACK: global vars for tracking drag position in FF.
var __clientX, clientY;

//---------------------------------------------------------
// utils
//---------------------------------------------------------

var alphabet = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
                "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];

var KEYS = {UP: 38,
            DOWN: 40,
            ENTER: 13,
            Z: 90};

function coerceInput(input) {
  if(input.match(/^-?[\d]+$/gim)) {
    return parseInt(input);
  } else if(input.match(/^-?[\d]+\.[\d]+$/gim)) {
    return parseFloat(input);
  }
  return input;
}

function stopPropagation(e) {
  e.stopPropagation();
}
function preventDefault(e) {
  e.preventDefault();
}

function now() {
  if(window.performance) {
    return window.performance.now();
  }
  return (new Date()).getTime();
}

function canvasRatio(context) {
  var devicePixelRatio = window.devicePixelRatio || 1;
  var backingStoreRatio = context.webkitBackingStorePixelRatio ||
      context.mozBackingStorePixelRatio ||
      context.msBackingStorePixelRatio ||
      context.oBackingStorePixelRatio ||
      context.backingStorePixelRatio || 1;

  return devicePixelRatio / backingStoreRatio;
}

function clearDragImage(e, elem) {
  e.dataTransfer.setData("text", "foo");
  e.dataTransfer.setDragImage(document.getElementById("clear-pixel"), 0, 0);
}

//---------------------------------------------------------
// Root
//---------------------------------------------------------

window.addEventListener("resize", rerender);
document.body.addEventListener("dragover", function(e) {
  //@HACK: because Firefox is a browser full of sadness, they refuse to
  //set clientX and clientY on drag events. As such we have this ridiculous
  //workaround of tracking position at the body.
  __clientX = e.clientX;
  __clientY = e.clientY;
});
document.body.addEventListener("drop", preventDefault);

function root() {
  return {id: "root",
          c: "root",
          children: [
            toolbar(),
            stage(),
          ]};
}

//---------------------------------------------------------
// Toolbar
//---------------------------------------------------------

function toolbar() {
  return {c: "toolbar", text: "toolbar"};
}

//---------------------------------------------------------
// Stage
//---------------------------------------------------------

function stageScrollTop() {
  return document.getElementsByClassName("stage-tiles-wrapper")[0].scrollTop;
}

function stage() {
  var rect = window.document.body.getBoundingClientRect();
  grid = Grid.makeGrid({bounds: {top: rect.top, left: rect.left + 10, width: rect.width - 120, height: rect.height - toolbarOffset}, gutter: 8});
  var active = "grid://default";
  var removed = ixer.index("remove");
  var tiles = ixer.index("gridToTile")[active].filter(function(cur) {
    return !removed[cur[0]];
  });
  var drawnTiles = tiles.map(function(cur) {
    return gridTile(cur, tiles);
  });
  var outline = ixer.index("tileOutline")[client];
  if(outline && !removed[outline[0]]) {
    drawnTiles.push(tileOutline(outline));
  }
  return {c: "stage", children: [{c: "stage-tiles-wrapper", scroll: onStageScroll, tiles: tiles,
                                  draggable: true, dragstart: startTile, drag: layoutTile, dragend: createTile, outline: outline,
                                  children: [{c: "stage-tiles", top:0, left:0, height:(rect.height - toolbarOffset) * 10, children: drawnTiles}]},
                                 minimap(rect, tiles)]};
}

function tileOutline(outline) {
  var pos = Grid.getOutlineRect(grid, outline);
  return {c: "tile-outline", top: pos.top, left: pos.left, width: pos.width, height: pos.height};
}

var scrollTimer;
function stopScrolling() {
  document.body.classList.remove("scrolling");
}

function onStageScroll() {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(stopScrolling, 100)
  document.body.classList.add("scrolling");
  rerender();
}

function startTile(e, elem) {
  if(e.target !== e.currentTarget) return;
  clearDragImage(e);
  var x = e.clientX || __clientX;
  var y = (e.clientY || __clientY) + stageScrollTop() - toolbarOffset;
  var pos = Grid.coordsToPos(grid, x, y, true);
  dispatch("tileOutline", {outline: [null, client, pos[0], pos[1], 1, 1]});
}

function layoutTile(e, elem) {
  if(!elem.outline) return;
  var x = e.clientX || __clientX;
  var y = (e.clientY || __clientY)
  if(x === 0 && y === 0) return;
  y = y + stageScrollTop() - toolbarOffset;
  var outline = elem.outline;
  var tiles = elem.tiles;
  var rect = Grid.getOutlineRect(grid, outline);
  var width = Math.max(x - rect.left, 1);
  var height = Math.max(y - rect.top, 1);
  var size = Grid.coordsToSize(grid, width, height, true);
  var neue = outline.slice();
  neue[4] = size[0];
  neue[5] = size[1];
  if((neue[4] !== outline[4] || neue[5] !== outline[5]) &&
     !Grid.hasOverlap(tiles, [null, null, null, null, outline[2], outline[3], neue[4], neue[5]])) {
    dispatch("tileOutline", {outline: neue});
  }

}

function createTile(e, elem) {
  if(!elem.outline || e.target !== e.currentTarget) return;
  dispatch("addTileFromOutline", {outline: elem.outline});
}

//---------------------------------------------------------
// Minimap
//---------------------------------------------------------

function navigateMinimap(e) {
  var y = e.clientY - toolbarOffset;
  var stageNode = document.getElementsByClassName("stage-tiles-wrapper")[0];
  var rect = window.document.body.getBoundingClientRect();
  stageNode.scrollTop = (y * 10) - ((rect.height - toolbarOffset) / 2)
}

function minimap(bounds, tiles) {
  var gridBounds = {top: 0, left: 0, width: 100, height: (bounds.height - toolbarOffset) / 10};
  var grid = Grid.makeGrid({bounds: gridBounds, gutter: 2});
  var drawnTiles = tiles.map(function(cur) {
    return minimapTile(grid, cur);
  });
  var stageNode = document.getElementsByClassName("stage-tiles-wrapper");
  var scroll = stageNode[0] ? stageNode[0].scrollTop / 10 : 0;
  var thumb = {c: "thumb", top: scroll, left: 0, width:100, height: gridBounds.height}
  return {c: "minimap", click: navigateMinimap, children: [thumb, {children: drawnTiles}]};
}

function minimapTile(grid, tile) {
  var pos = Grid.getRect(grid, tile);
  var name = code.tileToName(tile);
  return {c: "minimap-tile " + tile[3], top: pos.top, left: pos.left, width: pos.width, height: pos.height, text: name };
}

//---------------------------------------------------------
// input
//---------------------------------------------------------

function input(value, key, oninput, onsubmit) {
  var blur, keydown;
  if(onsubmit) {
    blur = function inputBlur(e, elem) {
      onsubmit(e, elem, "blurred");
    }
    keydown = function inputKeyDown(e, elem) {
      if(e.keyCode === KEYS.ENTER) {
        onsubmit(e, elem, "enter");
      }
    }
  }
  return {c: "input", contentEditable: true, input: oninput, text: value, key: key, blur: blur, keydown: keydown};
}

//---------------------------------------------------------
// Grid tile
//---------------------------------------------------------

function gridTile(cur, activeTiles) {
  var pos = Grid.getRect(grid, cur);
  return {c: "grid-tile", top: pos.top, left: pos.left, width: pos.width, height: pos.height,
          children: [tiles[cur[3]](cur), tileControls(cur, activeTiles)]};
}

function tileControls(cur, activeTiles) {
  return {c: "controls", children: [
    {c: "close-tile ion-close", tx: cur[0], click: removeTile},
    {c: "move-tile ion-arrow-move", tile: cur, tiles: activeTiles, draggable: true, drag: moveTile, dragstart: clearDragImage},
    {c: "resize-tile ion-drag", tile: cur, tiles: activeTiles, dragover: preventDefault, draggable: true, drag: resizeTile, dragstart: clearDragImage}
  ]}
}

function removeTile(e, elem) {
  dispatch("remove", {tx: elem.tx});
}

function moveTile(e, elem) {
  var x = e.clientX || __clientX;
  var y = e.clientY || __clientY;
  if(x === 0 && y === 0) return;
  y = y - toolbarOffset;
  var tile = elem.tile;
  var tiles = elem.tiles;
  var rect = Grid.getRect(grid, tile);
  var handlePos = e.currentTarget.getBoundingClientRect();
  var top = rect.top + (y - handlePos.top);
  var left = rect.left + (x - handlePos.left);
  var pos = Grid.coordsToPos(grid, left, top, true);
  var neue = tile.slice();
  neue[4] = Math.max(pos[0], 0);
  neue[5] = Math.max(pos[1], 0);
  if((neue[4] !== tile[4] || neue[5] !== tile[5]) &&
     !Grid.hasOverlap(tiles, neue)) {
    dispatch("updateTile", {neue: neue});
  }
  e.stopPropagation();
}

function resizeTile(e, elem) {
  var x = e.clientX || __clientX;
  var y = e.clientY || __clientY;
  if(x === 0 && y === 0) return;
  x = x + document.getElementsByClassName("stage-tiles-wrapper")[0].scrollLeft;
  y = y + document.getElementsByClassName("stage-tiles-wrapper")[0].scrollTop - toolbarOffset;
  var tile = elem.tile;
  var tiles = elem.tiles;
  var rect = Grid.getRect(grid, tile);
  var width = Math.max(x - rect.left, 1);
  var height = Math.max(y - rect.top, 1);
  var size = Grid.coordsToSize(grid, width, height, true);
  var neue = tile.slice();
  neue[6] = size[0];
  neue[7] = size[1];
  if((neue[6] !== tile[6] || neue[7] !== tile[7]) &&
     !Grid.hasOverlap(tiles, neue)) {
    dispatch("updateTile", {neue: neue});
  }
  e.stopPropagation();
}


//---------------------------------------------------------
// table
// @TODO
// - field editing
// - adder rows
//---------------------------------------------------------

function rename(e, elem) {
  var value = e.currentTarget.textContent;
  if(value !== code.name(elem.key)) {
    dispatch("rename", {value: value, id: elem.key});
  }
}

function updateAdder(e, elem) {
  dispatch("updateAdderRow", {value: coerceInput(e.currentTarget.textContent),
                              row: elem.key.row,
                              ix: elem.key.ix});
}

function table(id, fields, rows, adderRows) {
  var ths = fields.map(function(cur) {
    var oninput, onsubmit;
    if(cur.id) {
      oninput = onsubmit = rename;
    }
    return {t: "th", children: [input(cur.name, cur.id, oninput, onsubmit)]};
  });
  var trs = rows.map(function(cur) {
    var tds = [];
    for(var i = 0, len = cur.length; i < len; i++) {
      tds[i] = {t: "td", text: cur[i]};
    }
    return {t: "tr", children: tds};
  });
  adderRows.forEach(function(adder) {
    var cur = adder[3];
    var tds = [];
    for(var i = 0, len = fields.length; i < len; i++) {
      tds[i] = {t: "td", children: [input(cur[i], {row: adder, ix: i}, updateAdder)]};
    }
    trs.push({t: "tr", children: tds});
  });
  return {t: "table", children: [
    {t: "thead", children: [
      {t: "tr", children: ths}
    ]},
    {t: "tbody", children: trs}
  ]};
}

//---------------------------------------------------------
// table tile
//---------------------------------------------------------

function addColumn(e, elem) {
  dispatch("addColumn", {view: elem.view});
}

function tableTile(cur) {
  var view = ixer.index("tableTile")[cur[1]][1];
  var fields = code.viewToFields(view).map(function(cur) {
    return {name: code.name(cur[2]), id: cur[2]};
  });
  var rows = ixer.facts(view);
  var adderRows = ixer.index("adderRows")[view] || [];
  return {c: "tile table-tile", children: [table("foo", fields, rows, adderRows),
                                     {c: "add-column ion-plus", view: view, click: addColumn}]};
}


//---------------------------------------------------------
// ui tile
// @TODO
// - grid
// - attributes
// - stopPropagation doesn't appear to stop the outer div from
//   scrolling
//---------------------------------------------------------

var attrMappings = {"content": "text"};

function uiTile(cur) {
  var tileId = cur[1];
  var elements = ixer.index("uiComponentToElements")[tileId] || [];
  var layers = ixer.index("uiComponentToLayers")[tileId];
  var attrs = ixer.index("uiElementToAttrs");
  var els = elements.map(function(cur) {
    var id = cur[1];
    var elem = {c: "control", left: cur[5], top: cur[6], width: cur[7] - cur[5], height: cur[8] - cur[6]};
    var elemAttrs = attrs[id];
    if(!elemAttrs) return elem;
    for(var i = 0, len = elemAttrs.length; i < len; i++) {
      var curAttr = elemAttrs[i];
      var name = attrMappings[curAttr[2]] || curAttr[2];
      elem[name] = curAttr[3];
    }
    return elem;
  });
  return {c: "tile ui-editor", children: [
    uiControls(tileId, layers[0]),
    {c: "ui-canvas", children: els},
    {c: "inspector", children: [layersControl(layers)]},
//     uiGrid({width: 1000, height: 300}),
  ]};
}

function addControl(e, elem) {
  dispatch("addUiComponentElement", {component: elem.component,
                                     layer: elem.layer,
                                     control: elem.control,
                                     left: elem.left || 100,
                                     right: elem.right || 200,
                                     top: elem.top || 100,
                                     bottom: elem.bottom || 200})
}

function uiControls(component, activeLayer) {
  var controls = ["text", "box", "button"];
  var items = controls.map(function(cur) {
    return {text: cur, click: addControl, control: cur, component: component, layer: activeLayer};
  })
  return {c: "controls", children: items};
}

function layersControl(layers) {
  var layerElems = layers.map(function(cur) {
    var hidden = cur[5];
    var locked = cur[4];
    var name = code.name(cur[1]);
    return {c: "layer", children: [
      {c: "ion-drag"},
      input(name),
      {c: hidden ? "ion-eye-disabled" : "ion-eye"},
      {c: locked ? "ion-locked" : "ion-unlocked"}
    ]};
  });
  return {c: "layers", children: layerElems};
}

function uiGrid(size) {
  return {t: "canvas", top: 10, left: 50, width: size.width, height: size.height,
         postRender: function(canvas) {
           var ctx = canvas.getContext("2d");
           var ratio = canvasRatio(ctx);
           console.time("drawGrid");
           canvas.width = size.width * ratio;
           canvas.height = size.height * ratio;
           ctx.scale(ratio, ratio);
           ctx.lineWidth = 1;
           ctx.strokeStyle = "white";
           for(var i = 0; i < 300; i++) {
             if(i % 10 === 0) {
               ctx.globalAlpha = 0.4;
             } else {
               ctx.globalAlpha = 0.2;
             }
             ctx.beginPath();
             ctx.moveTo(i * 10,0);
             ctx.lineTo(i * 10,size.height * 2);
             ctx.stroke();
             ctx.beginPath();
             ctx.moveTo(0, i * 10);
             ctx.lineTo(size.width * 2, i * 10);
             ctx.stroke();
           }
           console.timeEnd("drawGrid");
         }};
}

//---------------------------------------------------------
// Expression
//---------------------------------------------------------

//---------------------------------------------------------
// view tile
//---------------------------------------------------------

function viewTile(cur) {
  var view = ixer.index("viewTile")[cur[1]][1];
  var sources = ixer.index("viewToSources")[view] || [];
  var results = ixer.facts(view);
  return {c: "tile view-tile", children: [
    viewCode(view, sources),
    viewResults(sources, results)
  ]};
}

function viewCode(view, sources) {
  var sourceElems = sources.map(function(cur) {
    var data = cur[3];
    if(data[0] === "view") {
      return {c: "step", children: [
        {children: [
          {text: "with "},
          {c: "token", text: "each row"},
          {text: " of "},
          {text: code.name(data[1])}
        ]}
      ]};
    }
    return {text: "calculate"};
  });
  return {c: "view-source-code", children: sourceElems};
}

function viewResults(sources, results) {
  var tableHeaders = [];
  var fieldHeaders = [];
  var rows = [];
  var sourceFieldsLength = [];
  sources.forEach(function(cur) {
    var data = cur[3];
    if(data[0] === "view") {
      var view = data[1];
      var fields = code.viewToFields(view);
      sourceFieldsLength.push(fields.length);
      tableHeaders.push({t: "th", colspan: fields.length, text: code.name(view)}, {t: "th", c: "gap"})
      fields.forEach(function(field) {
        fieldHeaders.push({t: "th", text: code.name(field[2])});
      });
      fieldHeaders.push({t: "th", c: "gap"});
    } else {
      tableHeaders.push({t: "th", text: "TODO: calculations"}, {t: "th", c: "gap"});
      fieldHeaders.push({t: "th", text: "result"}, {t: "th", c: "gap"});
      sourceFieldsLength.push(1);
    }
  });
  //remove trailing gaps
  tableHeaders.pop();
  fieldHeaders.pop();
  var sourcesLen = sources.length;
  results.forEach(function(row) {
    var neue = [];
    for(var i = 0; i < sourcesLen; i++) {
      var fields = row[i];
      if(!fields) {
        neue.push({t: "td", colspan: sourceFieldsLength[i], c: "failed"});
        neue.push({t: "td", c: "gap failed"});
      } else {
        var fieldsLen = fields.length;
        for(var fieldIx = 0; fieldIx < fieldsLen; fieldIx++) {
          neue.push({t: "td", text: fields[fieldIx]});
        }
        neue.push({t: "td", c: "gap"});
      }
    }
    neue.pop();
    rows.push({t: "tr", children: neue});
  });
  return {t: "table", c: "results", children: [
    {t: "thead", children: [
      {t: "tr", c: "table-headers", children: tableHeaders},
      {t: "tr", c: "field-headers", children: fieldHeaders}
    ]},
    {t: "tbody", children: rows}
  ]};
}

//---------------------------------------------------------
// chooser tile
//---------------------------------------------------------

function chooseTile(e, info) {
  dispatch(info.type, {tileId: info.tile[1]});
}

function chooserTile(cur) {
  return {c: "chooser-tile", children: [
    {c: "option", click: chooseTile, type: "addUi", tile: cur, children: [
      {c: "icon ion-image",},
      {c: "description", text: "Present data in a new drawing"},
    ]},
    {c: "option", click: chooseTile, type: "addTable", tile: cur, children: [
      {c: "icon ion-compose"},
      {c: "description", text: "Record data in a new table"},
    ]},
    {c: "option",click: chooseTile, type: "addView", tile: cur, children: [
      {c: "icon ion-ios-calculator"},
      {c: "description", text: "Work with data in a new view"},
    ]},
  ]};
}

var tiles = {ui: uiTile, table: tableTile, view: viewTile, addChooser: chooserTile};

//---------------------------------------------------------
// Dispatch
//---------------------------------------------------------

function dispatch(event, info) {
  var storeEvent = true;
  var diffs = [];
  var txId = {"eid": "auto"};

  switch(event) {
    case "rename":
      diffs.push(["displayName", "inserted", [txId, info.id, info.value]]);
      break;
    case "addTable":
      var tileId = info.tileId;
      var oldTile = ixer.index("gridTile")[tileId].slice();
      var tile = oldTile.slice();
      //set to a table tile
      tile[0] = txId;
      tile[3] = "table";
      var tableId = uuid();
      diffs = code.diffs.addView("Untitled Table", {A: "string"}, undefined, tableId, ["table"]);
      diffs.push(["gridTile", "inserted", tile],
                 ["tableTile", "inserted", [tileId, tableId]],
                 ["adderRow", "inserted", [txId, txId, tableId, []]]);
      break;
    case "addView":
      var tileId = info.tileId;
      var oldTile = ixer.index("gridTile")[tileId].slice();
      var tile = oldTile.slice();
      //set to a table tile
      tile[0] = txId;
      tile[3] = "view";
      var viewId = uuid();
      diffs = code.diffs.addView("Untitled View", {}, undefined, viewId, ["view"], "query");
      diffs.push(["gridTile", "inserted", tile],
                 ["viewTile", "inserted", [tileId, viewId]]);
      break;
    case "addUi":
      var tileId = info.tileId;
      var oldTile = ixer.index("gridTile")[tileId].slice();
      var tile = oldTile.slice();
      //set to a table tile
      tile[0] = txId;
      tile[3] = "ui";
      diffs.push(["gridTile", "inserted", tile]);
      var id = uuid();
      var neue = [txId, id, tileId, 0, false, false];
      diffs.push(["uiComponentLayer", "inserted", neue],
                 ["displayName", "inserted", [id, "Layer " + 0]]);
      break;
    case "updateTile":
      var neue = info.neue.slice();
      neue[0] = txId;
      diffs.push(["gridTile", "inserted", neue]);
      break;
    case "tileOutline":
      var neue = info.outline;
      neue[0] = txId;
      diffs.push(["tileOutline", "inserted", neue]);
      break;
    case "addTileFromOutline":
      var outline = info.outline;
      var x = outline[2];
      var y = outline[3];
      var w = outline[4];
      var h = outline[5];
      var neue = [txId, uuid(), "grid://default", "addChooser", x, y, w, h];
      diffs.push(["gridTile", "inserted", neue],
                 ["remove", "inserted", [outline[0]]]);
      break;
    case "addUiComponentElement":
      var neue = [txId, uuid(), info.component, info.layer, info.control, info.left, info.top, info.right, info.bottom];
      diffs.push(["uiComponentElement", "inserted", neue]);
      break;
    case "addUiComponentLayer":
      var id = uuid();
      var neue = [txId, id, info.component, info.layer, false, false];
      diffs.push(["uiComponentLayer", "inserted", neue],
                 ["displayName", "inserted", [id, "Layer " + info.layer]]);
      break;

    case "updateAdderRow":
      var neue = info.row.slice();
      if(neue[3].length === 0) {
        //this was the last empty adderRow, which means we need to add a new one
        diffs.push(["adderRow", "inserted", [txId, txId, neue[2], []]]);
      }
      neue[0] = txId;
      neue[3][info.ix] = info.value;
      diffs.push(["adderRow", "inserted", neue])
      break;
    case "addColumn":
      var viewId = info.view;
      var view = ixer.index("view")[viewId];
      var fields = code.viewToFields(viewId) || [];
      var schema = view[1];
      var fieldId = uuid();
      diffs.push(["field", "inserted", [schema, fields.length, fieldId, "unknown"]],
                 ["displayName", "inserted", [{"eid": "auto"}, fieldId, alphabet[fields.length]]]);
      break;
    case "remove":
      diffs.push(["remove", "inserted", [info.tx]]);
      break;
    default:
      console.error("Dispatch for unknown event: ", event, info);
      return;
      break;
  }

//   if(storeEvent) {
//     var eventItem = {event: event, diffs: diffs, children: [], parent: eventStack};
//     eventStack.children.push(eventItem);
//     eventStack = eventItem;
//   }

  sendToServer(diffs);

}

//---------------------------------------------------------
// Rendering
//---------------------------------------------------------

var renderer = new microReact.Renderer();
document.body.appendChild(renderer.content);
var queued = false;
function rerender() {
  if(!queued) {
    queued = true;
    requestAnimationFrame(forceRender);
  }
}

function forceRender() {
  renderer.render(root());
  queued = false;
}

//---------------------------------------------------------
// Data API
//---------------------------------------------------------

var code = {
  diffs: {
    addView: function(name, fields, initial, id, tags, type) { // (S, {[S]: Type}, Fact[]?, Uuid?, S[]?) -> Diffs
      id = id || uuid();
      var schema = uuid();
      var fieldIx = 0;
      var diffs = [["displayName", "inserted", [{"eid": "auto"}, id, name]],
                   ["schema", "inserted", [schema]]];
      for(var fieldName in fields) {
        if(!fields.hasOwnProperty(fieldName)) { continue; }
        var fieldId = uuid()
        diffs.push(["field", "inserted", [schema, fieldIx++, fieldId, fields[fieldName]]],
                   ["displayName", "inserted", [{"eid": "auto"}, fieldId, fieldName]]);
      }

      diffs.push(["view", "inserted", [id, schema, type || "input"]]);
      if(initial && initial.length) {
        for(var initIx = 0, initLen = initial.length; initIx < initLen; initIx++) {
          diffs.push([id, "inserted", initial[initIx]]);
        }
      }
      if(tags) {
        for(var tagIx = 0, tagLen = tags.length; tagIx < tagLen; tagIx++) {
          diffs.push(["tag", "inserted", [id, tags[tagIx]]]);
        }
      }
      return diffs;
    },
    autoJoins: function(view, sourceView, sourceId) {
      var displayNames = ixer.index("displayName");
      var sources = ixer.index("viewToSources")[view] || [];
      var fields = code.viewToFields(sourceView);
      var diffs = [];
      fields = fields.map(function(cur) {
        return [cur[2], displayNames[cur[2]]];
      });
      sources.forEach(function(cur) {
        theirFields = code.viewToFields(cur[3][1]);
        if(!theirFields) return;

        for(var i in theirFields) {
          var theirs = theirFields[i];
          for(var x in fields) {
            var myField = fields[x];
            if(displayNames[theirs[2]] === myField[1]) {
              //same name, join them.
              diffs.push(
                ["constraint", "inserted",
                 [code.ast.fieldSourceRef(sourceId, myField[0]),
                  "=",
                  code.ast.fieldSourceRef(cur[2], theirs[2])]]);
            }
          }
        }
      });
      return diffs;
    }
  },
  ui: {
    updateAttribute: function(attribute, txId) {
      var diffs = [];
      var neue = [txId, attribute.id, attribute.property, attribute.value, false];
      var oldProps = ixer.index("uiElementToAttr")[attribute.id];
      diffs.push(["uiComponentAttribute", "inserted", neue]);
      if(oldProps) {
        var oldProp = oldProps[attribute.property];
        if(oldProp) {
          diffs.push(["deletion", "inserted", [txId, oldProp[0]]]);
        }
      }
      return diffs;
    }
  },
  hasTag: function(id, tag) {
    var tags = ixer.index("tag")[id];
    for(var ix in tags) {
      if(tags[ix][1] == tag) {
        return true;
      }
    }
    return false;
  },
  ast: {
    fieldSourceRef: function(source, field) {
      return ["column", source, field];
    },
  },
  viewToFields: function(view) {
    var schema = ixer.index("viewToSchema")[view];
    return ixer.index("schemaToFields")[schema];
  },
  refToName: function(ref) {
    switch(ref[0]) {
      case "column":
        var view = code.name(ixer.index("sourceToData")[ref[1]][1]);
        var field = code.name(ref[2]);
        return {string: view + "." + field, view: view, field: field};
        break;
      default:
        return "Unknown ref: " + JSON.stringify(ref);
        break;
    }
  },
  refToType: function(ref) {
    return ixer.index("field")[ref[2]][3];
  },
  typesEqual: function(a, b) {
    //@TODO: equivalence. e.g. int = number
    return a === b;
  },
  viewToRefs: function(view, ofType) {
    var refs = [];
    var sources = ixer.index("viewToSources")[view] || [];
    sources.forEach(function(source) {
      var viewOrData = source[3];
      var sourceView = viewOrData[1];
      //view
      if(viewOrData[0] !== "view") {
        //@TODO: handle getting the refs for functions
        sourceView = null;
      } else {
        code.viewToFields(sourceView).forEach(function(field) {
          if(!ofType || ofType === field[3]) {
            refs.push(code.ast.fieldSourceRef(source[2], field[2]));
          }
        });
      }
    });
    return refs;
  },
  tileToName: function(tile) {
    switch(tile[3]) {
      case "ui":
        return "ui";
        break;
      case "table":
        var table = ixer.index("tableTile")[tile[1]][1];
        return code.name(table);
        break;
      case "view":
        var table = ixer.index("viewTile")[tile[1]][1];
        return code.name(table);
        break;
    }
  },
  name: function(id) {
    return ixer.index("displayName")[id];
  }
};

//---------------------------------------------------------
// Indexes
//---------------------------------------------------------

// Core
ixer.addIndex("tag", "tag", Indexing.create.collector([0]));
ixer.addIndex("displayName", "displayName", Indexing.create.latestLookup({keys: [1, 2]}));
ixer.addIndex("view", "view", Indexing.create.lookup([0, false]));
ixer.addIndex("field", "field", Indexing.create.lookup([2, false]));
ixer.addIndex("sourceToData", "source", Indexing.create.lookup([2, 3]));
ixer.addIndex("editId", "editId", Indexing.create.latestLookup({keys: [1,2,3]}));
ixer.addIndex("viewToSchema", "view", Indexing.create.lookup([0, 1]));
ixer.addIndex("viewToSources", "source", Indexing.create.collector([0]));
ixer.addIndex("schemaToFields", "field", Indexing.create.collector([0]));
ixer.addIndex("remove", "remove", Indexing.create.lookup([0, 0]));
ixer.addIndex("adderRows", "adderRow", Indexing.create.latestCollector({keys: [2], uniqueness: [1]}));

// ui
ixer.addIndex("uiComponentElement", "uiComponentElement", Indexing.create.latestLookup({keys: [1, false]}));
ixer.addIndex("uiComponentToElements", "uiComponentElement", Indexing.create.latestCollector({keys: [2], uniqueness: [1]}));
ixer.addIndex("uiComponentLayer", "uiComponentLayer", Indexing.create.latestLookup({keys: [1, false]}));
ixer.addIndex("uiComponentToLayers", "uiComponentLayer", Indexing.create.latestCollector({keys: [2], uniqueness: [1]}));
ixer.addIndex("uiElementToAttrs", "uiComponentAttribute", Indexing.create.latestCollector({keys: [1], uniqueness: [1, 2]}));
ixer.addIndex("uiElementToAttr", "uiComponentAttribute", Indexing.create.latestLookup({keys: [1, 2, false]}));

// Grid Indexes
ixer.addIndex("gridTarget", "gridTarget", Indexing.create.latestLookup({keys: [1, 2]}));
ixer.addIndex("gridTile", "gridTile", Indexing.create.latestLookup({keys: [1, false]}));
ixer.addIndex("gridToTile", "gridTile", Indexing.create.latestCollector({keys: [2], uniqueness: [1]}));
ixer.addIndex("tableTile", "tableTile", Indexing.create.lookup([0, false]));
ixer.addIndex("viewTile", "viewTile", Indexing.create.lookup([0, false]));
ixer.addIndex("tileOutline", "tileOutline", Indexing.create.latestLookup({keys: [1, false]}));



function initIndexer() {
  ixer.handleDiffs(code.diffs.addView("transaction", {id: "id"}, undefined, "transaction", ["table"]));
  ixer.handleDiffs(code.diffs.addView("remove", {id: "id"}, undefined, "remove", ["table"]));
  ixer.handleDiffs(
    code.diffs.addView("schema", {id: "id"}, [], "schema", ["table"]));
  ixer.handleDiffs(
    code.diffs.addView("field", {schema: "id", ix: "int", id: "id", type: "type"}, [], "field", ["table"]));
  ixer.handleDiffs(
    code.diffs.addView("primitive", {id: "id", inSchema: "id", outSchema: "id"}, [], "primitive", ["table"]));
  ixer.handleDiffs(
    code.diffs.addView("view", {id: "id", schema: "id", kind: "query|union"}, [], "view", ["table"]));
  ixer.handleDiffs(
    code.diffs.addView("source", {view: "id", ix: "int", id: "id", data: "data", action: "get-tuple|get-relation"}, [], "source", ["table"]));
  ixer.handleDiffs(
    code.diffs.addView("constraint", {left: "reference", op: "op", right: "reference"}, [], "constraint", ["table"]));
  ixer.handleDiffs(code.diffs.addView("tag", {id: "id", tag: "string"}, undefined, "tag", ["table"]));
  ixer.handleDiffs(code.diffs.addView("displayName", {tx: "number", id: "string", name: "string"}, undefined, "displayName", ["table"]));
  ixer.handleDiffs(code.diffs.addView("tableTile", {id: "string", view: "string"}, undefined, "tableTile", ["table"]));
  ixer.handleDiffs(code.diffs.addView("viewTile", {id: "string", view: "string"}, undefined, "viewTile", ["table"]));


  ixer.handleDiffs(code.diffs.addView("adderRow", {tx: "id", id: "id", table: "id", row: "tuple"}, undefined, "adderRow", ["table"]));
  ixer.handleDiffs(code.diffs.addView("tileOutline", {tx: "id", client: "id", x: "number", y: "number", w: "number", h: "number"}, undefined, "tileOutline", ["table"]));

  ixer.handleDiffs(code.diffs.addView("zomg", {
    a: "string",
    e: "number",
    f: "number"
  }, [
    ["a", "b", "c"],
    ["d", "e", "f"]
  ], "zomg", ["table"]));

  ixer.handleDiffs(code.diffs.addView("foo", {
    a: "string",
    b: "number",
  }, [
    ["a", "b"],
    ["d", "e"]
  ], "foo", ["table"]));

  //example tables
  ixer.handleDiffs(
    code.diffs.addView("employees", {department: "string", name: "string", salary: "float"}, [], false, ["table"]));
  ixer.handleDiffs(
    code.diffs.addView("department heads", {department: "string", head: "string"}, [], false, ["table"]));


  // grid views
  var gridId = "grid://default";
  var uiViewId = uuid();
  var bigUiViewId = uuid();
  ixer.handleDiffs(code.diffs.addView("gridTile", {
    tx: "number",
    tile: "string",
    grid: "string",
    type: "string",
    x: "number",
    y: "number",
    w: "number",
    h: "number"
  }, [
    [0, uiViewId, gridId, "ui", 0, 12, 12, 6],
    [0, bigUiViewId, "grid://ui", "ui", 0, 12, 12, 12],
  ], "gridTile", ["table"]));

  ixer.handleDiffs(code.diffs.addView(
    "activeGrid",
    {tx: "number", grid: "string"},
    [[0, gridId]],
    "activeGrid", ["table"]));

  ixer.handleDiffs(code.diffs.addView(
    "gridTarget",
    {tx: "number", tile: "string", target: "string"}, [
      [uiViewId, "grid://ui"],
      [bigUiViewId, "grid://default"]
    ], "gridTarget", ["table"]));

  // ui views
  ixer.handleDiffs(
    code.diffs.addView("uiComponentElement", {tx: "number", id: "string", component: "string", layer: "number", control: "string", left: "number", top: "number", right: "number", bottom: "number"}, [], "uiComponentElement", ["table"]));
  ixer.handleDiffs(
    code.diffs.addView("uiComponentLayer", {tx: "number", id: "string", component: "string", layer: "number", locked: "boolean", invisible: "boolean"}, [], "uiComponentLayer", ["table"]));
  ixer.handleDiffs(
    code.diffs.addView("uiComponentAttribute", {tx: "number", id: "string", property: "string", value: "string", isBinding: "boolean"}, [], "uiComponentAttribute", ["table"])); // @FIXME: value: any

  var firstLayerId = uuid();
  ixer.handleDiffs([["uiComponentLayer", "inserted", [0, firstLayerId, uiViewId, 0, false, false]],
                   ["displayName", "inserted", [0, firstLayerId, "Layer 0"]]]);
}

//---------------------------------------------------------
// Websocket
//---------------------------------------------------------

var server = {connected: false, queue: [], initialized: false, lastSent: []};
function connectToServer() {
  var queue = server.queue;
  var ws = new WebSocket('ws://localhost:2794', []);
  server.ws = ws;

  ws.onerror = function (error) {
    console.log('WebSocket Error ' + error);
  };

  ws.onmessage = function (e) {
    var data = JSON.parse(e.data);
    if(!server.initialized && !data.changes["view"]) {
      initIndexer();
      server.ws.send(JSON.stringify(ixer.dumpMapDiffs()));
      ixer.clear();
      server.initialized = true;
    }
//     console.log("received", data.changes);
    ixer.handleMapDiffs(data.changes);

    rerender();
  };

  ws.onopen = function() {
    server.connected = true;
    for(var i = 0, len = queue.length; i < len; i++) {
      sendToServer(queue[i]);
    }
  }
}

function sendToServer(message) {
  if(!server.connected) {
    server.queue.push(message);
  } else {
    if(!Indexing.arraysIdentical(server.lastSent, message)) {
//       console.log("sending", message);
      server.lastSent = message;
      server.ws.send(JSON.stringify(toMapDiffs(message)));
    }
  }
}

function toMapDiffs(diffs) {
  var final = {};
  for(var i = 0, len = diffs.length; i < len; i++) {
    var cur = diffs[i];
    var table = cur[0];
    var action = cur[1];
    var fact = cur[2];
    if(!final[table]) {
      final[table] = {inserted: [], removed: []};
    }
    final[table][action].push(fact);
  }
  return {changes: final};
}

connectToServer();
