if(typeof window === 'undefined') {
  jsc = require("./resources/jsverify.js");
}

// UTIL

function assert(cond, msg) {
  if(!cond) {
    throw new Error(msg);
  }
}

function makeArray(len, fill) {
  var arr = [];
  for(var i = 0; i < len; i++) {
    arr[i] = fill;
  }
  return arr;
}

function fillArray(arr, fill) {
  for(var i = 0; i < arr.length; i++) {
    arr[i] = fill;
  }
}

function readFrom(ixes, local, remote) {
  var len = ixes.length;
  assert(len === local.length);
  for (var i = 0; i < len; i++) {
    local[i] = remote[ixes[i]];
  }
}

function writeTo(ixes, local, remote) {
  var len = ixes.length;
  assert(len === local.length);
  for (var i = 0; i < len; i++) {
    remote[ixes[i]] = local[i];
  }
}

// ORDERING / COMPARISON

var least = false;
var greatest = undefined;

function compareValue(a, b) {
  if(a === b) return 0;
  var at = typeof a;
  var bt = typeof b;
  if((at === bt && a < b) || (at < bt)) return -1;
  return 1;
}

function containsPoint(los, his, point) {
  var len = los.length;
  assert(len === his.length);
  assert(len === point.length);
  for (var i = 0; i < len; i++) {
    if ((compareValue(point[i], los[i]) === -1) || compareValue(point[i], his[i]) !== -1) {
      return false;
    }
  }
  return true;
}

function containsVolume(los, his, innerLos, innerHis) {
  var len = los.length;
  assert(len === his.length);
  assert(len === innerLos.length);
  assert(len === innerHis.length);
  for (var i = 0; i < len; i++) {
    if ((compareValue(innerLos[i], los[i]) === -1) || compareValue(innerHis[i], his[i]) === 1) {
      return false;
    }
  }
  return true;
}

function intersectsVolume(losA, hisA, losB, hisB) {
  var len = losA.length;
  assert(len === hisA.length);
  assert(len === losB.length);
  assert(len === hisB.length);
  for (var i = 0; i < len; i++) {
    if ((compareValue(losA[i], hisB[i]) !== -1) || compareValue(losB[i], hisA[i]) !== -1) {
      return false;
    }
  }
  return true;
}

function arrayEqual(a, b) {
  var len = a.length;
  if(len !== b.length) throw new Error("arrayEqual on arrays of different length: " + a + " :: " + b);
  for(var i = 0; i < len; i++) {
    if(a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function nestedEqual(a, b) {
  if (!(a instanceof Array)) return a === b;
  if (!(b instanceof Array)) return false;
  var len = a.length;
  if(len !== b.length) return false;
  for(var i = 0; i < len; i++) {
    if (!nestedEqual(a[i], b[i])) {
      return false;
    }
  }
  return true;
}

// MTREE
// track a multi-set of volumes
// supports bounds refinement

function Volume(los, his) {
  this.los = los;
  this.his = his;
}

function MTree(factLen, volumes) {
  this.factLen = factLen;
  this.volumes = volumes;
}

function MTreeConstraint(ixes, pointful, volumes, los, his) {
  this.ixes = ixes;
  this.pointful = pointful;
  this.volumes = volumes;
  this.los = los;
  this.his = his;
}

MTree.empty = function(factLen) {
  return new MTree(factLen, []);
};

MTreeConstraint.fresh = function(ixes) {
  var pointful = true;
  var volumes = [];
  var los = makeArray(ixes.length, least);
  var his = makeArray(ixes.length, greatest);
  return new MTreeConstraint(ixes, pointful, volumes, los, his);
};

MTree.prototype = {
  update: function(adds, dels) {
    var volumes = this.volumes;
    for (var i = adds.length - 1; i >= 0; i--) {
      volumes.push(adds[i]);
    }
    outer: for (var i = dels.length - 1; i >= 0; i--) {
      var del = dels[i];
      inner: for (var j = volumes.length - 1; j >= 0; j--) {
        var volume = volumes[j];
        if (arrayEqual(del.los, volume.los) && arrayEqual(del.his, volume.his)) {
          volumes.splice(j, 1);
          continue outer;
        }
      }
    }
  },
};

// TODO pointful stuff is a hack - we really need a different datastructure for the provenance constraint
MTreeConstraint.prototype = {
  reset: function(mtree) {
    this.volumes = mtree.volumes.slice();
    fillArray(this.los, least);
    fillArray(this.his, greatest);
  },

  copy: function() {
    return new MTreeConstraint(this.ixes, this.pointful, this.volumes.slice(), this.los.slice(), this.his.slice());
  },

  propagate: function(solverState) {
    var ixes = this.ixes;
    var volumes = this.volumes;
    var solverLos = solverState.los;
    var solverHis = solverState.his;
    var los = this.los;
    var his = this.his;
    var provenance = solverState.provenance;

    readFrom(ixes, los, solverLos);
    readFrom(ixes, his, solverHis);

    var pointful = this.pointful;
    for (var i = volumes.length - 1; i >= 0; i--) {
      var volume = volumes[i];
      if (((!pointful && (intersectsVolume(los, his, volume.los, volume.his) === false))) ||
          ((pointful && (containsPoint(los, his, volume.los) === false)))) {
        volumes.splice(i, 1);
      }
    }

    if (volumes.length === 0) {
      console.log("Failed with no volumes");
      solverState.isFailed = true;
      if (pointful) provenance.add(new Region(solverLos.slice(), solverHis.slice(), los.slice(), his.slice(), false));
      return true;
    }

    var changed = false;

    for (var i = ixes.length - 1; i >= 0; i--) {
      var newLo = greatest;
      for (var j = volumes.length - 1; j >= 0; j--) {
        var volume = volumes[j];
        var volumeLo = volume.los[i];
        if (compareValue(volumeLo, newLo) === -1) newLo = volumeLo;
      }
      var ix = ixes[i];
      if (compareValue(newLo, los[i]) === 1) {
        var memoryLos = los.slice();
        var notLos = solverLos.slice();
        var memoryHis = his.slice();
        var notHis = solverHis.slice();
        los[i] = newLo;
        solverLos[ix] = newLo;
        memoryHis[i] = newLo;
        notHis[ix] = newLo;
        if (pointful) provenance.add(new Region(notLos, notHis, memoryLos, memoryHis, false));
        changed = true;
      }
    }

    return changed;
  },

  split: function(leftSolverState, rightSolverState) {
    var volumes = this.volumes;
    if (volumes.length < 2) {
      return false;
    } else {
      // TODO this split algorithm can sometimes fail to change the right state
      var ixes = this.ixes;
      var volumeIx = Math.floor(Math.random() * volumes.length);
      var i = Math.floor(Math.random() * ixes.length);
      var ix = ixes[i];
      var pivot = volumes[volumeIx].los[i];
      console.log("Split at fact[" + ix + "]=" + pivot);
      leftSolverState.his[ix] = pivot;
      rightSolverState.los[ix] = pivot;
      return true;
    }
  },

  witness: function(solverState) {
    var ixes = this.ixes;
    var solverLos = solverState.los;
    var solverHis = solverState.his;
    var los = this.los;
    var his = this.his;
    readFrom(ixes, los, solverLos);
    readFrom(ixes, his, solverHis);
    solverState.provenance.add(new Region(solverLos.slice(), solverHis.slice(), los.slice(), his.slice(), true));
  }
};

// PTREE
// records a single provenance for each possible solver point
// tracks dirty volumes when memory changes

function Region(solverLos, solverHis, memoryLos, memoryHis, isSolution) {
  this.solverLos = solverLos;
  this.solverHis = solverHis;
  this.memoryLos = memoryLos;
  this.memoryHis = memoryHis;
  this.isSolution = isSolution;
}

function PTree(regions) {
  this.regions = regions;
}

PTree.empty = function() {
  return new PTree([]);
};

PTree.prototype = {
  dirty: function(points, delledRegions) {
    var regions = this.regions;
    outer: for (var i = regions.length - 1; i >= 0; i--) {
      var region = regions[i];
      var los = region.memoryLos;
      var his = region.memoryHis;
      inner: for (var j = points.length - 1; j >= 0; j--) {
        var point = points[j];
        if (containsVolume(los, his, point, point)) {
          regions.splice(i, 1);
          delledRegions.push(region);
          continue outer;
        }
      }
    }
  },

  clean: function(newRegions, outputAdds, outputDels) {
    var regions = this.regions;

    outer: for (var i = regions.length - 1; i >= 0; i--) {
      var oldRegion = regions[i];
      var oldLos = oldRegion.solverLos;
      var oldHis = oldRegion.solverHis;
      inner: for (var j = newRegions.length - 1; j >= 0; j--) {
        var newRegion = newRegions[j];
        var newLos = newRegion.solverLos;
        var newHis = newRegion.solverHis;
        if (intersectsVolume(oldLos, oldHis, newLos, newHis)) {
          if (containsVolume(oldLos, oldHis, newLos, newHis)) {
            newRegions.slice(j, 1);
            continue inner;
          } else if (containsVolume(newLos, newHis, oldLos, oldHis)) {
            regions.slice(i, 1);
            if (oldRegion.isSolution) outputDels.push(oldLos);
            continue outer;
          } else if (containsPoint(newLos, newHis, oldLos) && oldRegion.isSolution) {
            oldRegion.isSolution = false;
            outputDels.push(oldRegion.solverLos);
          } else if (containsPoint(oldLos, oldHis, newLos) && newRegion.isSolution) {
            assert(false); // the solver should not generate solutions that are contained by non-dirty regions
          }
        }
      }
    }

    for (var i = newRegions.length - 1; i >= 0; i--) {
      var newRegion = newRegions[i];
      regions.push(newRegion);
      if (newRegion.isSolution) outputAdds.push(newRegion.solverLos);
    }
  },
};

// PROVENANCE

function Provenance(numVars, factLen, regions, ptree) {
  this.numVars = numVars;
  this.factLen = factLen;
  this.regions = regions;
  this.ptree = ptree;
  this.ixes = [];
  for (var i = 0; i < this.numVars; i++) {
    this.ixes[i] = i;
  }
}

Provenance.empty = function (numVars, factLen) {
  var provenance = new Provenance(numVars, factLen, [], PTree.empty());
  provenance.add(new Region(makeArray(numVars, least), makeArray(numVars, greatest), makeArray(factLen, least), makeArray(factLen, greatest), false));
  provenance.finish([],[]);
  return provenance;
};

Provenance.prototype =  {
  add: function (region) {
    this.regions.push(region);
  },

  start: function (inputAdds, inputDels, outputDels) {
    var delledRegions = [];
    this.ptree.dirty(inputAdds, delledRegions);
    this.ptree.dirty(inputDels, delledRegions);
    if (delledRegions.length === 0) {
      return null;
    } else {
      for (var i = delledRegions.length - 1; i >= 0; i--) {
        var delledRegion = delledRegions[i];
        if (delledRegion.isSolution) outputDels.push(delledRegion.solverLos);
      }
      var constraint = MTreeConstraint.fresh(this.ixes);
      constraint.pointful = false;
      var volumes = constraint.volumes;
      for (var i = delledRegions.length - 1; i >= 0; i--) {
        var delledRegion = delledRegions[i];
        volumes[i] = new Volume(delledRegion.solverLos, delledRegion.solverHis);
      }
      return constraint;
    }
  },

  finish: function (outputAdds, outputDels) {
    this.ptree.clean(this.regions, outputAdds, outputDels);
    this.regions = [];
  }
};

// SOLVER

function SolverState(provenance, constraints, los, his, isFailed) {
  this.provenance = provenance;
  this.constraints = constraints;
  this.los = los;
  this.his = his;
  this.isFailed = isFailed;
}

SolverState.prototype = {
  propagate: function() {
    var constraints = this.constraints;
    var numConstraints = this.constraints.length;
    var lastChanged = 0;
    var current = 0;
    while (true) {
      console.log("Before prop " + current + " " + this.los + " " + this.his);
      if (this.isFailed === true) break;
      var changed = constraints[current].propagate(this);
      if (changed === true) lastChanged = current;
      console.log("After prop " + current + " " + this.los + " " + this.his);
      current = (current + 1) % numConstraints;
      if (current === lastChanged) break;
    }
  },

  split: function() {
    var constraints = this.constraints;
    var leftSolverState = this;
    var rightSolverState = new SolverState(this.provenance, constraints.slice(), this.los.slice(), this.his.slice(), this.isFailed);
    for (var i = constraints.length - 1; i >= 0; i--) {
      constraints[i] = constraints[i].copy();
    }
    for (var splitter = constraints.length - 1; splitter >= 1; splitter--) {
      if (constraints[splitter].split(leftSolverState, rightSolverState)) break;
    }
    if (splitter >= 1) {
      console.log("Split by " + splitter);
      return rightSolverState;
    } else {
      console.log("No split at " + this.los);
      return null; // found a solution
    }
  }
};

function Solver(numVars, constraints, provenance) {
  this.numVars = numVars;
  this.constraints = constraints;
  this.provenance = provenance;
}

Solver.prototype = {
  update: function(memory, inputAdds, inputDels, outputAdds, outputDels) {
    var provenance = this.provenance;
    var provenanceConstraint = provenance.start(inputAdds, inputDels, outputDels);
    if (provenanceConstraint === null) {
      // no changes
      return;
    }

    var constraints = this.constraints.slice();
    for (var i = constraints.length - 1; i >= 0; i--) {
      constraints[i].reset(memory);
    }
    constraints.unshift(provenanceConstraint);

    var numVars = this.numVars;
    var states = [new SolverState(provenance, constraints, makeArray(numVars, least), makeArray(numVars, greatest), false)];
    while (states.length > 0) {
      var state = states.pop();
      state.propagate();
      if (state.isFailed === true) {
        console.log("Failed");
      } else {
        var rightState = state.split();
        if (rightState === null) {
          // pick an arbitary constraint to add a proof for this solved state
          constraints[1].witness(state);
        } else {
          states.push(state);
          states.push(rightState);
        }
      }
    }

    provenance.finish(outputAdds, outputDels);
  }
};

// TESTS

var jsc = jsc;
var gen = {};

function Unshrinkable() {}

gen.tuple = function (gens) {
  return {
    arbitrary: function(size) {
      var tuple = [];
      for (var i = 0; i < gens.length; i++) {
        tuple[i] = gens[i].arbitrary(size);
      }
      return tuple;
    },
    randomShrink: function(tuple) {
      var shrunk = tuple.slice();
      var i = jsc._.random(0, tuple.length - 1);
      shrunk[i] = gens[i].randomShrink(shrunk[i]);
      return shrunk;
    },
    show: function(tuple) {
      var shown = tuple.slice();
      for (var i = 0; i < shown.length; i++) {
        shown[i] = gens[i].show(shown[i]);
      }
      return "[" + shown.join(", ") + "]";
    },
  };
};

gen.array = function(gen, n) {
  return {
    arbitrary: function(size) {
      var array = [];
      var length = n || jsc._.random(1,size);
      for (var i = 0; i < length; i++) {
        array[i] = gen.arbitrary(size);
      }
      return array;
    },
    randomShrink: function(array) {
      if (array.length === 0) {
        throw new Unshrinkable();
      } else {
        var shrunk = array.slice();
        var i = jsc._.random(0, array.length - 1);
        if ((n === undefined) && (jsc._.random(0,1) === 0)) {
          shrunk.splice(i, 1);
        } else {
          shrunk[i] = gen.randomShrink(shrunk[i]);
        }
        return shrunk;
      }
    },
    show: JSON.stringify,
  };
};

var maxShrinks = 1000;

// limit to 'maxShrinks' random shrink attempts
function shrinkwrap(gen) {
  return {
    arbitrary: gen.arbitrary,
    shrink: function(value) {
      var shrinks = [];
      for (var i = 0; i < maxShrinks; i++) {
        try {
          shrinks[i] = gen.randomShrink(value);
        } catch (err) {
          if (err.constructor !== Unshrinkable) throw err;
        }
      }
      return shrinks;
    },
    show: gen.show,
  };
}

// shrinkwrap gens before handing over to jsc
function forall() {
  var args = Array.prototype.slice.call(arguments);
  var gens = args.slice(0, args.length - 1);
  var fun = args[args.length - 1];
  var wrapped = shrinkwrap(gen.tuple(gens));
  var forall = jsc.forall(wrapped, function(vals) { return fun.apply(null, vals); });
  forall.gens = gens;
  forall.fun = fun;
  forall.wrapped = wrapped;
  return forall;
}

function assertAll(props, opts) {
  for (var prop in props) {
    jsc.assert(props[prop], opts);
  }
}

gen.value = function () {
  return {
    arbitrary: function(size) {
      var i = jsc._.random(-size, size);
      return (jsc._.random(0,1) === 0) ? i.toString() : i;
    },
    randomShrink: function(value) {
      if (typeof(value) === 'string') {
        var asInt = parseInt(value);
        if ((jsc._.random(0,1) === 0) && !isNaN(asInt)) {
          return asInt;
        } else if (value === "") {
          throw new Unshrinkable();
        }
        else {
          return value.slice(0, value.length - 1);
        }
      } else {
        if (value === 0) {
          throw new Unshrinkable();
        } else {
          return jsc._.random((1-value),(value-1));
        }
      }
    },
    show: JSON.stringify,
  };
};

gen.eav = function() {
  return gen.array(gen.value(), 3);
};

// SOLVER TESTS

function deltaEquivalentTo(actualAdds, actualDels, expectedAdds, expectedDels) {
  outer: for (var i = actualAdds.length - 1; i >= 0; i--) {
    for (var j = actualDels.length - 1; j >= 0; j--) {
      if (nestedEqual(actualAdds[i], actualDels[j])) {
        actualAdds.splice(i, 1);
        actualDels.splice(j, 1);
        continue outer;
      }
    }
  }
  return nestedEqual(actualAdds, expectedAdds) && nestedEqual(actualDels, expectedDels);
}

var m = MTree.empty(3);
var c0 = MTreeConstraint.fresh([0,1,2]);
var c1 = MTreeConstraint.fresh([0,1,2]);
var p = Provenance.empty(3, 3);
var s = new Solver(3, [c0, c1], p);

var inputAdds = [];
var inputDels = [];
var outputAdds = [];
var outputDels = [];
s.update(m, inputAdds, inputDels, outputAdds, outputDels);
assert(deltaEquivalentTo(outputAdds, outputDels, [], []));

p

m.update([new Volume([0,0,0],[0,0,0])], []);
var inputAdds = [[0,0,0]];
var inputDels = [];
var outputAdds = [];
var outputDels = [];
s.update(m, inputAdds, inputDels, outputAdds, outputDels);
assert(deltaEquivalentTo(outputAdds, outputDels, [[0,0,0]], []));

p

m.update([new Volume([1,1,1],[1,1,1])], []);
var inputAdds = [[1,1,1]];
var inputDels = [];
var outputAdds = [];
var outputDels = [];
s.update(m, inputAdds, inputDels, outputAdds, outputDels);
assert(deltaEquivalentTo(outputAdds, outputDels, [[1,1,1]], []));

m.update([new Volume([2,2,2],[2,2,2]), new Volume([3,3,3],[3,3,3])], []);
var inputAdds = [[2,2,2],[3,3,3]];
var inputDels = [];
var outputAdds = [];
var outputDels = [];
s.update(m, inputAdds, inputDels, outputAdds, outputDels);
assert(deltaEquivalentTo(outputAdds, outputDels, [[2,2,2],[3,3,3]], []));

m.update([], [new Volume([1,1,1],[1,1,1])]);
var inputAdds = [];
var inputDels = [[1,1,1]];
var outputAdds = [];
var outputDels = [];
s.update(m, inputAdds, inputDels, outputAdds, outputDels);
assert(deltaEquivalentTo(outputAdds, outputDels, [], [[1,1,1]]));

var solverProps = {
  selfJoin: forall(gen.array(gen.eav()),
                     function (facts) {
                       var tree = btree(10, 3);
                       var constraint0 = new IteratorConstraint(iterator(tree));
                       var constraint1 = new IteratorConstraint(iterator(tree));
                       var selfSolver = solver(3, [constraint0, constraint1], [[0,1,2],[0,1,2]]);
                       for (var i = 0; i < facts.length; i++) {
                         tree.add(facts[i]);
                       }
                       var returnedFacts = [];
                       selfSolver.solve(returnedFacts);

                       var expectedFacts = tree.keys();
                       return nestedEqual(returnedFacts, expectedFacts);
                     }),

  productJoin: forall(gen.array(gen.eav()),
                     function (facts) {
                       var tree = btree(10, 3);
                       var constraint0 = new IteratorConstraint(iterator(tree));
                       var constraint1 = new IteratorConstraint(iterator(tree));
                       var productSolver = solver(6, [constraint0, constraint1], [[0,1,2],[3,4,5]]);
                       for (var i = 0; i < facts.length; i++) {
                         tree.add(facts[i]);
                       }
                       var returnedFacts = [];
                       productSolver.solve(returnedFacts);

                       var uniqueSortedFacts = tree.keys();
                       var expectedFacts = [];
                       for (var i = 0; i < uniqueSortedFacts.length; i++) {
                         for (var j = 0; j < uniqueSortedFacts.length; j++) {
                           expectedFacts.push(uniqueSortedFacts[i].concat(uniqueSortedFacts[j]));
                         }
                       }
                       return nestedEqual(returnedFacts, expectedFacts);
                     })
};

assertAll(solverProps, {tests: 5000});

function solverRegressionTest() {
  var tree0 = btree(10, 2);
  var tree1 = btree(10, 2);
  var constraint0 = new IteratorConstraint(iterator(tree0));
  var constraint1 = new IteratorConstraint(iterator(tree1));
  var regressionSolver = solver(3, [constraint0, constraint1], [[0,2],[1,2]]);

  tree0.add(["a", "b"]);
  tree0.add(["b", "c"]);
  tree0.add(["c", "d"]);
  tree0.add(["d", "b"]);

  tree1.add(["b", "a"]);
  tree1.add(["c", "b"]);
  tree1.add(["d", "c"]);
  tree1.add(["b", "d"]);

  var returnedFacts = [];
  regressionSolver.solve(returnedFacts);
  assert(nestedEqual(returnedFacts, [["a","c","b"],["b","d","c"],["c","b","d"],["d","c","b"]]));
}

solverRegressionTest();