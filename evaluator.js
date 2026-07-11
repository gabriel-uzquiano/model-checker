/**
 * FOL Model Evaluator
 *
 * A model is:
 * {
 *   domain: ['1','2','3'],            // non-empty array of strings
 *   interp: {
 *     F: ['1','2'],                   // unary predicate → set of elements
 *     R: [['1','2'],['2','3']],       // binary predicate → set of pairs
 *     a: '1',                         // constant → element
 *     b: '2',
 *   }
 * }
 *
 * An environment (variable assignment) is a plain object: { x: '1', y: '2' }
 *
 * folEvaluate(ast, model) returns:
 * {
 *   value: true | false,
 *   steps: [{ depth, formula, reason, value }]
 * }
 */

/**
 * folEvaluate(ast, model, initEnv)
 *
 * initEnv is an optional variable assignment { x: '1', y: '2', … } that
 * seeds the evaluation for open formulas.  When omitted (or empty) the
 * formula must be closed; any still-unbound variable will throw at
 * denoteTerm time.
 */
function folEvaluate(ast, model, initEnv) {
  const steps = [];
  const baseEnv = initEnv || {};

  function evalNode(node, env, depth) {
    const formulaStr = prettyPrint(node, env);

    function record(value, reason) {
      steps.push({ depth, formula: formulaStr, reason, value });
      return value;
    }

    switch (node.type) {

      case 'pred': {
        const args = node.args.map(t => denoteTerm(t, env, model));
        const ext = model.interp[node.name];

        // Treat missing extension as empty set (false for all)
        if (ext === undefined) {
          if (node.args.length === 0) {
            return record(false, `${node.name} is not set to true in the model`);
          } else if (node.args.length === 1) {
            return record(false, `${args[0]} ∉ I(${node.name}) — extension is empty`);
          } else {
            return record(false, `⟨${args.join(',')}⟩ ∉ I(${node.name}) — extension is empty`);
          }
        }

        let val;
        if (node.args.length === 0) {
          // 0-ary: treated as propositional constant
          val = ext === true || (Array.isArray(ext) && ext.length > 0);
          return record(val, `${node.name} is ${val ? 'true' : 'false'} in the model`);
        } else if (node.args.length === 1) {
          val = Array.isArray(ext) && ext.includes(args[0]);
          return record(val, `${args[0]} ${val ? '∈' : '∉'} I(${node.name})`);
        } else {
          // n-ary (n ≥ 2): check if tuple is in extension
          val = Array.isArray(ext) && ext.some(tuple =>
            Array.isArray(tuple) && tuple.length === args.length &&
            tuple.every((el, i) => el === args[i])
          );
          return record(val, `⟨${args.join(',')}⟩ ${val ? '∈' : '∉'} I(${node.name})`);
        }
      }

      case 'eq': {
        const l = denoteTerm(node.left, env, model);
        const r = denoteTerm(node.right, env, model);
        return record(l === r, `${l} ${l === r ? '=' : '≠'} ${r}`);
      }

      case 'neg': {
        const v = evalNode(node.arg, env, depth + 1);
        return record(!v, `Negation — subformula is ${v ? 'true' : 'false'}`);
      }

      case 'and': {
        const l = evalNode(node.left, env, depth + 1);
        if (!l) return record(false, `Conjunction — left conjunct is false`);
        const r = evalNode(node.right, env, depth + 1);
        return record(r, r
          ? `Conjunction — both conjuncts are true`
          : `Conjunction — right conjunct is false`);
      }

      case 'or': {
        const l = evalNode(node.left, env, depth + 1);
        if (l) return record(true, `Disjunction — left disjunct is true`);
        const r = evalNode(node.right, env, depth + 1);
        return record(r, r
          ? `Disjunction — right disjunct is true`
          : `Disjunction — both disjuncts are false`);
      }

      case 'imp': {
        const l = evalNode(node.left, env, depth + 1);
        if (!l) return record(true, `Conditional — antecedent is false, so the conditional is true`);
        const r = evalNode(node.right, env, depth + 1);
        return record(r, r
          ? `Conditional — antecedent and consequent are both true`
          : `Conditional — antecedent is true but consequent is false`);
      }

      case 'iff': {
        const l = evalNode(node.left, env, depth + 1);
        const r = evalNode(node.right, env, depth + 1);
        return record(l === r, `Biconditional — both sides are ${l === r
          ? `${l ? 'true' : 'false'} (same value)`
          : 'different values'}`);
      }

      case 'all': {
        const v = node.var;
        let allTrue = true;
        let witnessEl = null;
        steps.push({ depth: depth + 1, formula: '', reason: `Universal — checking every element of the domain for ${v}`, value: null, isRuleHeader: true });
        for (const d of model.domain) {
          const newEnv = Object.assign({}, env, { [v]: d });
          steps.push({
            depth: depth + 1,
            formula: prettyPrint(node.arg, newEnv),
            reason: `trying ${v} = ${d}`,
            value: null  // placeholder; updated below
          });
          const stepIdx = steps.length - 1;
          const val = evalNode(node.arg, newEnv, depth + 2);
          steps[stepIdx].value = val;
          if (!val) { allTrue = false; witnessEl = d; break; }
        }
        return record(allTrue, allTrue
          ? `Universal — true for every element of the domain`
          : `Universal — false: counterexample ${v} = ${witnessEl}`);
      }

      case 'exi': {
        const v = node.var;
        let found = false;
        let witnessEl = null;
        steps.push({ depth: depth + 1, formula: '', reason: `Existential — searching for a witness for ${v}`, value: null, isRuleHeader: true });
        for (const d of model.domain) {
          const newEnv = Object.assign({}, env, { [v]: d });
          steps.push({
            depth: depth + 1,
            formula: prettyPrint(node.arg, newEnv),
            reason: `trying ${v} = ${d}`,
            value: null
          });
          const stepIdx = steps.length - 1;
          const val = evalNode(node.arg, newEnv, depth + 2);
          steps[stepIdx].value = val;
          if (val) { found = true; witnessEl = d; break; }
        }
        return record(found, found
          ? `Existential — true, witness ${v} = ${witnessEl}`
          : `Existential — no witness found; false for every element of the domain`);
      }

      default:
        throw new Error('Unknown node type: ' + node.type);
    }
  }

  const value = evalNode(ast, baseEnv, 0);
  return { value, steps };
}

function denoteTerm(term, env, model) {
  // First check variable assignment, then constant interpretation
  if (env && env[term.name] !== undefined) return env[term.name];
  if (model.interp && model.interp[term.name] !== undefined) {
    return model.interp[term.name];
  }
  // If the term looks like a variable (x, y, z, ...) and has no assignment, error
  if (/^[vwxyz]/.test(term.name)) {
    throw new Error(`Variable '${term.name}' has no assignment — use the α(${term.name}) dropdown to assign it a value.`);
  }
  // Otherwise treat as a constant equal to its own name (must be in domain)
  return term.name;
}

/**
 * Validate a model against a parsed formula's signature.
 * Returns array of warning strings (empty = OK).
 */
function validateModel(model, sig) {
  const warnings = [];
  if (!model.domain || model.domain.length === 0) {
    warnings.push('Domain is empty — please add at least one element.');
    return warnings;
  }

  // Check for duplicate domain elements
  const seen = new Set();
  for (const el of model.domain) {
    if (seen.has(el)) warnings.push(`Domain element '${el}' appears more than once.`);
    seen.add(el);
  }

  // Check constants are mapped to domain elements
  for (const c of sig.consts) {
    // Skip variables (x, y, z) — they're bound by quantifiers
    if (/^[xyz]/.test(c)) continue;
    const val = model.interp[c];
    if (val === undefined) {
      warnings.push(`Constant '${c}' has no interpretation — assign it a domain element.`);
    } else if (!model.domain.includes(val)) {
      warnings.push(`Constant '${c}' is assigned '${val}', which is not in the domain.`);
    }
  }

  // Check predicate extensions are subsets of domain^n
  for (const [name, arity] of Object.entries(sig.predicates)) {
    const ext = model.interp[name];
    if (ext === undefined) continue; // treated as empty extension
    if (arity === 0) continue;
    if (arity === 1) {
      if (!Array.isArray(ext)) {
        warnings.push(`Extension of ${name} should be a list of elements.`);
        continue;
      }
      for (const el of ext) {
        if (!model.domain.includes(el))
          warnings.push(`'${el}' in extension of ${name} is not a domain element.`);
      }
    } else {
      // arity >= 2
      if (!Array.isArray(ext)) {
        warnings.push(`Extension of ${name} should be a list of ${arity}-tuples.`);
        continue;
      }
      for (const tuple of ext) {
        if (!Array.isArray(tuple) || tuple.length !== arity) {
          warnings.push(`${name} extension should contain ${arity}-tuples.`);
          continue;
        }
        for (const el of tuple) {
          if (!model.domain.includes(el))
            warnings.push(`'${el}' in relation ${name} is not a domain element.`);
        }
      }
    }
  }
  return warnings;
}
