var stress_test = function(count) {
  count = count || 10000;

  for (var i = 0; i < count; ++i) {
    var node = {
      id: i.toString(),
      deps: []
    };

    if (i === 0) {
      register(node);
      continue;
    }

    while (Math.floor(Math.random() * 2)) {
      var dep = Math.floor(Math.random() * i).toString();
      if (node.deps.indexOf(dep) === -1)
        node.deps.push(dep);
    }

    register(node);
  };
}

