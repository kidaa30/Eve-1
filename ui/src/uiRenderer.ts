/// <reference path="./microReact.ts" />
/// <reference path="./indexer.ts" />
/// <reference path="./api.ts" />
module uiRenderer {
  declare var DEBUG;

  type Id = string;
  type RowTokeyFn = (row:{[key:string]: any}) => string;

  interface Element extends microReact.Element {
    __template:string // The id of the uiElement that spawned this element. This relationship may be many to one when bound.
    __binding?:string // The key which matches this element to it's source row and view if bound.
  }

  interface UiWarning {
    element: string
    row: any[]
    warning: string
  }

  api.ixer.addIndex("ui parent to elements", "uiElement", Indexing.create.collector(["uiElement: parent"]));
  api.ixer.addIndex("ui element to attributes", "uiAttribute", Indexing.create.collector(["uiAttribute: element"]));
  api.ixer.addIndex("ui element to attribute bindings", "uiAttributeBinding", Indexing.create.collector(["uiAttributeBinding: element"]));

  export class UiRenderer {
    public refreshRate:number = 16;   // Duration of a frame in ms.
    public queued:boolean = false;    // Whether the model is dirty and requires rerendering.
    public warnings:UiWarning[] = []; // Warnings from the previous render (or all previous compilations).
    public compiled:number = 0;       // # of elements compiled since last render.

    constructor(public renderer:microReact.Renderer) {

    }

    // Mark the renderer dirty so it will rerender next frame.
    queue(root) {
      if(this.queued === false) {
        this.queued = true;
        // @FIXME: why does using request animation frame cause events to stack up and the renderer to get behind?
        let self = this;
        setTimeout(function() {
          var start = performance.now();
          api.ixer.clearTable("uiWarning");
          let warnings;
          // Rerender until all generated warnings have been committed to the indexer.
          do {
            var tree = root();
            let elements = (api.ixer.select("tag", {tag: "editor-ui"}) || []).map((tag) => tag["tag: view"]);
            start = performance.now();
            elements.unshift(tree);
            warnings = self.render(elements);
            if(warnings.length) {
              api.ixer.handleDiffs(api.toDiffs(
                api.insert("uiWarning", warnings)
              ))
            }
          } while(warnings.length > 0);

          var total = performance.now() - start;
          if(total > 10) {
            console.log("Slow render: " + total);
          }
          self.queued = false;
        }, this.refreshRate);
      }
    }

    // Render the given list of elements to the builtin microreact renderer.
    render(roots:(Id|Element)[]):UiWarning[] {
      this.compiled = 0;
      this.warnings = [];
      let elems = this.compile(roots);
      this.renderer.render(elems);
      let warnings = this.warnings;
      return warnings;
    }

    // @NOTE: In the interests of performance, roots will not be checked for ancestry --
    // instead of being a noop, specifying a child of a root as another root results in undefined behavior.
    // If this becomes a problem, it can be changed in the loop that initially populates compiledElements.
    compile(roots:(Id|Element)[]):microReact.Element[] {
      let elementToChildren = api.ixer.index("ui parent to elements", true);
      let elementToAttrs = api.ixer.index("ui element to attributes", true);
      let elementToAttrBindings = api.ixer.index("ui element to attribute bindings", true);

      let stack:Element[] = [];
      let compiledElements:microReact.Element[] = [];
      let keyToRow:{[key:string]: any} = {};
      let boundAncestors:{[id:string]: Element} = {};
      for(let root of roots) {
        if(typeof root === "object") {
          compiledElements.push(<Element>root);
          continue;
        }

        let fact = api.ixer.selectOne("uiElement", {element: root});
        let elem:Element = {id: <string>root, __template: <string>root};
        if(fact && fact["uiElement: parent"]) {
          elem.parent = fact["uiElement: parent"];
        }
        compiledElements.push(elem);
        stack.push(elem);
      }
      let start = Date.now();
      while(stack.length > 0) {
        let elem = stack.shift();
        let templateId = elem.__template;

        let fact = api.ixer.selectOne("uiElement", {element: templateId});
        if(!fact) { continue; }
        let attrs = elementToAttrs[templateId];
        let boundAttrs = elementToAttrBindings[templateId];
        let children = elementToChildren[templateId];

        let elems = [elem];
        let binding = api.ixer.selectOne("uiElementBinding", {element: templateId});
        if(binding) {
          // If the element is bound, it must be repeated for each row.
          var boundView = binding["uiElementBinding: view"];
          var rowToKey = this.generateRowToKeyFn(boundView);
          let oldKey = elem.__binding;
          var boundRows = this.getBoundRows(boundView, oldKey);
          elems = [];
          let ix = 0;
          for(let row of boundRows) {
            // We need an id unique per row for bound elements.
            let key = rowToKey(row);
            let childId = `${elem.id}.${ix}`;
            elems.push({t: elem.t, parent: elem.id, id: childId, __template: templateId, __binding: key});
            keyToRow[key] = row;
            if(DEBUG.RENDERER) {
              console.log(`* Linking ${childId} -> ${boundAncestors[elem.id] && boundAncestors[elem.id].id}.`);
            }
            boundAncestors[childId] = boundAncestors[elem.id];
            ix++;
          }
        }

        let rowIx = 0;
        for(let elem of elems) {
          this.compiled++;
          // Handle meta properties.
          let key = elem.__binding;
          elem.t = fact["uiElement: tag"];

          // Handle static properties.
          if(attrs) {
            for(let attr of attrs) {
              let {"uiAttribute: property": prop, "uiAttribute: value": val} = attr;
              elem[prop] = val;
              if(prop === "__binding") {
                binding = true;
                key = val;
              }
            }
          }

          // Handle bound properties.
          // @NOTE: making __binding dynamically bindable is possible, but requires processing it as the first bound attribute to have the intended effect.
          if(boundAttrs) {
            for(let attr of boundAttrs) {
              let {"uiAttributeBinding: property": prop, "uiAttributeBinding: field": field} = attr;
              let curElem = elem;
              let val;
              let scopeIx = 0;
              while(curElem && val === undefined) {
                let key = curElem.__binding;
                let row = keyToRow[key];
                val = row[field];

                if(val === undefined) {
                  curElem = boundAncestors[curElem.id];
                  if(scopeIx > 100) {
                    console.error(`Recursion detected in bound attribute resolution for key '${key}'.`);
                    break;
                  }
                  scopeIx++;
                }
              }
              elem[prop] = val;
              if(DEBUG.RENDERER) {
                console.log(`
                * Binding ${elem.id}['${prop}'] to ${field} (${val})
                   source elem: ${curElem && curElem.id}
                   row: ${curElem && JSON.stringify(keyToRow[curElem.__binding])}
                `);
              }
            }
          }

          // Prep children and add them to the stack.
          if(children) {
            let boundAncestor = boundAncestors[elem.id];
            if(binding) {
              boundAncestor = elem;
            }
            elem.children = [];
            for(let child of children) {
              let childTemplateId = child["uiElement: element"];
              let childId = `${elem.id}__${childTemplateId}`;
              boundAncestors[childId] = boundAncestor;
              let childElem = {id: childId, __template: childTemplateId, __binding: key};
              elem.children.push(childElem);
              stack.push(childElem);
            }
          }

          // Handle compiled element tags.
          let elementCompiler = elementCompilers[elem.t];
          if(elementCompiler) {
            try {
              elementCompiler(elem);
            } catch(err) {
              let row = keyToRow[key];
              let warning = {element: elem.id, row: row || "", warning: err.message};
              if(!api.ixer.selectOne("uiWarning", warning)) {
                this.warnings.push(warning);
              }
              elem["message"] = warning.warning;
              elem["element"] = warning.element;
              ui.uiError(<any> elem);
              console.warn("Invalid element:", elem);
            }
          }

          if(DEBUG.RENDERER) {
            elem.debug = elem.id;
          }

          rowIx++;
        }

        if(binding) {
          elem.children = elems;
        }
      }
      if(DEBUG.RENDER_TIME) {
        console.log(Date.now() - start);
      }
      return compiledElements;
    }

    // Generate a unique key for the given row based on the structure of the given view.
    generateRowToKeyFn(viewId:Id):RowTokeyFn {
      var keys = api.ixer.getKeys(viewId);
      if(keys.length > 1) {
        return (row:{}) => {
          return `${viewId}: ${keys.map((key) => row[key]).join(",")}`;
        };
      } else if(keys.length > 0) {
        return (row:{}) => {
          return `${viewId}: ${row[keys[0]]}`;
        }
      } else {
        return (row:{}) => `${viewId}: ${JSON.stringify(row)}`;
      }
    }

    getViewForKey(key:string):string {
      return key.slice(0, key.indexOf(":"));
    }

    // Get only the rows of view matching the key (if specified) or all rows from the view if not.
    getBoundRows(viewId:Id, key?:any): any[] {
      var keys = api.ixer.getKeys(viewId);
      if(key && keys.length === 1) {
        return api.ixer.select(viewId, {[api.code.name(keys[0])]: key});
      } else if(key && keys.length > 0) {
        let rowToKey = this.generateRowToKeyFn(viewId);
        return api.ixer.select(viewId, {}).filter((row) => rowToKey(row) === key);
      } else {
        return api.ixer.select(viewId, {});
      }
    }
  }

  export type ElementCompiler = (elem:microReact.Element) => void;
  export var elementCompilers:{[tag:string]: ElementCompiler} = {
    chart: (elem:ui.ChartElement) => {
      elem.pointLabels = (elem.pointLabels) ? [<any>elem.pointLabels] : elem.pointLabels;
      elem.ydata = (elem.ydata) ? [<any>elem.ydata] : [];
      elem.xdata = (elem.xdata) ? [<any>elem.xdata] : elem.xdata;
      ui.chart(elem);
    },
    "table-editor": uiEditor.table
  };
  export function addElementCompiler(tag:string, compiler:ElementCompiler) {
    if(elementCompilers[tag]) {
      throw new Error(`Refusing to overwrite existing compilfer for tag: "${tag}"`);
    }
    elementCompilers[tag] = compiler;
  }
}