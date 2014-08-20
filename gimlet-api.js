var fs = require('fs');
var pathLib = require('path');

var gimlet = module.exports = {
  init: function() {
    if (inRepo()) { return; }

    createFilesFromTree({
      ".gimlet": {
        HEAD: "ref: refs/heads/master\n",
        index: "",
        hooks: {},
        info: {},
        logs: {},
        objects: {},
        refs: {
          heads: {},
          remotes: {
            origin: {}
          },
          tags: {}
        }
      }
    });
  },

  add: function(path) {
    assertInRepo();

    if (util.isString(path)) {
      var files = index.getWorkingCopyFilesFrom(path);
      if (files.length === 0) {
        throw "fatal: pathspec '" + pathFromRepoRoot(path) + "' did not match any files";
      } else {
        for (var i = 0; i < files.length; i++) {
          this.update_index(files[i], { add: true });
        }
      }
    } else {
      throw "Nothing specified, nothing added.";
    }
  },

  update_index: function(path, opts) {
    assertInRepo();
    opts = opts || {};

    if (util.isString(path)) {
      var pathFromRoot = pathFromRepoRoot(path)
      if (!fs.existsSync(path)) {
        throw "error: " + pathFromRoot + ": does not exist\n" +
          "fatal: Unable to process path " + pathFromRoot;
      } else if (fs.statSync(path).isDirectory()) {
        throw "error: " + pathFromRoot + ": is a directory - add files inside instead\n" +
          "fatal: Unable to process path " + pathFromRoot;
      } else if (!index.hasFile(path) && opts.add === undefined) {
        throw "error: " + pathFromRoot  +
          ": cannot add to the index - missing --add option?\n" +
          "fatal: Unable to process path " + pathFromRoot;
      } else {
        index.addFile(path);
      }
    }
  },

  hash_object: function(file, opts) {
    assertInRepo();
    opts = opts || {};

    if (file !== undefined) {
      if (!fs.existsSync(file)) {
        throw "fatal: Cannot open '" + file + "': No such file or directory"
      } else {
        var fileContents = fs.readFileSync(file, "utf8");
        if (opts.w) {
          objectDatabase.writeObject(fileContents);
        }

        return hash(fileContents);
      }
    }
  },

  ls_files: function(opts) {
    assertInRepo();
    opts = opts || {};

    var indexObjs = index.get();
    if (opts.stage) {
      return Object.keys(indexObjs)
        .map(function(path) { return path + " " + indexObjs[path]; });
    } else {
      return Object.keys(indexObjs);
    }
  },

  write_tree: function() {
    assertInRepo();
    return objectDatabase.writeTree(index.toTree());
  }
};

var index = {
  hasFile: function(path) {
    return index.get()[path] !== undefined;
  },

  addFile: function(path) {
    var index = this.get();
    index[path] = hash(fs.readFileSync(pathLib.join(getRepoDir(), path), "utf8"));
    gimlet.hash_object(path, { w: true });
    this.set(index);
  },

  get: function() {
    return fs.readFileSync(pathLib.join(getGimletDir(), "index"), "utf8")
      .split("\n")
      .slice(0, -1) // chuck last empty line
      .reduce(function(index, blobStr) {
        var blobData = blobStr.split(/ /);
        index[blobData[0]] = blobData[1];
        return index;
      }, {});
  },

  set: function(index) {
    var indexStr = Object.keys(index)
        .map(function(path) { return path + " " + index[path]; })
        .join("\n")
        .concat("\n"); // trailing new line
    fs.writeFileSync(pathLib.join(getGimletDir(), "index"), indexStr);
  },

  getWorkingCopyFilesFrom: function(path) {
    if (!fs.existsSync(path)) {
      return [];
    } else if (fs.statSync(path).isFile()) {
      return path;
    } else if (fs.statSync(path).isDirectory()) {
      var self = this;
      return fs.readdirSync(path).reduce(function(files, dirChild) {
        return files.concat(self.getWorkingCopyFilesFrom(pathLib.join(path, dirChild)));
      }, []);
    }
  },

  toTree: function() {
    var tree = {};
    Object.keys(this.get()).forEach(function(wholePath) {
      (function addPathToTree(subTree, subPathParts) {
        if (subPathParts.length === 1) {
          subTree[subPathParts[0]] = fs.readFileSync(wholePath, "utf8");
        } else {
          addPathToTree(subTree[subPathParts[0]] = subTree[subPathParts[0]] || {},
                        subPathParts.slice(1));
        }
      })(tree, wholePath.split(pathLib.sep));
    });

    return tree;
  }
};

var objectDatabase = {
  writeTree: function(tree) {
    var treeObject = Object.keys(tree).map(function(key) {
      if (util.isString(tree[key])) {
        return "blob " + hash(tree[key]) + " " + key;
      } else {
        return "tree " + objectDatabase.writeTree(tree[key]) + " " + key;
      }
    }).join("\n") + "\n";

    this.writeObject(treeObject);
    return hash(treeObject);
  },

  writeObject: function(content) {
    var filePath = pathLib.join(getGimletDir(), "objects", hash(content));
    fs.writeFileSync(filePath, content);
  }
};

var hash = function(string) {
  return string
    .split("")
    .map(function(c) { return c.charCodeAt(0); })
    .reduce(function(a, n) { return a + n; }, 1000)
    .toString(16);
};

var getGimletDir = function(dir) {
  if (dir === undefined) { return getGimletDir(process.cwd()); }

  if (fs.existsSync(dir)) {
    var gimletDir = pathLib.join(dir, ".gimlet");
    if (fs.existsSync(gimletDir)) {
      return gimletDir;
    } else if (dir !== "/") {
      return getGimletDir(pathLib.join(dir, ".."));
    }
  }
};

var getRepoDir = function() {
  if (getGimletDir() !== undefined) {
    return pathLib.join(getGimletDir(), "..")
  }
};

var inRepo = function(cwd) {
  return getGimletDir(cwd) !== undefined;
};

var assertInRepo = function() {
  if (!inRepo()) {
    throw "fatal: Not a gimlet repository (or any of the parent directories): .gimlet";
  }
};

var pathFromRepoRoot = function(path) {
  return pathLib.relative(getRepoDir(), pathLib.join(process.cwd(), path));
};

var util = {
  pp: function(obj) {
    console.log(JSON.stringify(obj, null, 2))
  },

  isString: function(thing) {
    return typeof thing === "string";
  }
};

var createFilesFromTree = function(structure, prefix) {
  if (prefix === undefined) { return createFilesFromTree(structure, process.cwd()); }

  Object.keys(structure).forEach(function(name) {
    var path = pathLib.join(prefix, name);
    if (util.isString(structure[name])) {
      fs.writeFileSync(path, structure[name]);
    } else {
      fs.mkdirSync(path, "777");
      createFilesFromTree(structure[name], path);
    }
  });
};
