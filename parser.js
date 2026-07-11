/**
 * FOL Parser — accepts both ASCII and Unicode notation.
 *
 * ASCII:  ~  -   negation
 *         &  /\  conjunction
 *         |  \/  disjunction
 *         -> =>  conditional
 *         <-> <=> biconditional
 *         Ax Vx  universal  (A or V before a variable)
 *         Ex     existential
 *
 * Unicode: ¬ ∧ ∨ → ↔ ∀ ∃
 *
 * Grammar (precedence, low → high):
 *   formula ::= biconditional
 *   biconditional ::= conditional (<-> conditional)*
 *   conditional ::= disjunction (-> disjunction)*    [right-assoc]
 *   disjunction ::= conjunction (| conjunction)*
 *   conjunction ::= negation (& negation)*
 *   negation ::= ~ negation | quantified
 *   quantified ::= (A|V|∀) var quantified | (E|∃) var quantified | atom
 *   atom ::= term = term | pred(term,...) | pred term* | ( formula )
 *   term ::= const | var
 *
 * Returns an AST node:
 *   { type: 'neg', arg }
 *   { type: 'and', left, right }
 *   { type: 'or',  left, right }
 *   { type: 'imp', left, right }
 *   { type: 'iff', left, right }
 *   { type: 'all', var: v, arg }
 *   { type: 'exi', var: v, arg }
 *   { type: 'pred', name: P, args: [t,...] }
 *   { type: 'eq',  left: t, right: t }
 *   { type: 'const', name }
 *   { type: 'var',   name }
 */

// Normalise ASCII shorthands to canonical Unicode-like tokens before tokenising
function normalise(s) {
  // Replace multi-char ASCII first (order matters)
  return s
    .replace(/<->/g, '↔')
    .replace(/<=>/g, '↔')
    .replace(/->/g, '→')
    .replace(/=>/g, '→')
    .replace(/\/\\/g, '∧')
    .replace(/\\\//g, '∨')
    .replace(/¬/g, '¬')
    .replace(/~/g, '¬')
    // ASCII quantifiers: A/V followed by a variable character
    // We handle these in the tokeniser instead to avoid clashing with predicate A/V
    ;
}

// Token types
const TK = {
  NEG: 'NEG', AND: 'AND', OR: 'OR', IMP: 'IMP', IFF: 'IFF',
  ALL: 'ALL', EXI: 'EXI',
  LPAREN: 'LPAREN', RPAREN: 'RPAREN',
  EQ: 'EQ',
  UPPER: 'UPPER',   // predicate name (uppercase letter)
  LOWER: 'LOWER',   // variable or constant (lowercase letter + optional digits/primes)
  EOF: 'EOF',
};

// Human-readable token descriptions for error messages
const TK_NAMES = {
  NEG: '¬', AND: '∧', OR: '∨', IMP: '→', IFF: '↔',
  ALL: '∀', EXI: '∃',
  LPAREN: '(', RPAREN: ')',
  EQ: '=',
  UPPER: 'predicate',
  LOWER: 'variable/constant',
  EOF: 'end of input',
};

function tokenise(raw) {
  const s = normalise(raw.trim());
  const tokens = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }

    if (ch === '¬') { tokens.push({ type: TK.NEG }); i++; continue; }
    // Standalone '-' is negation only when NOT part of '->' (already normalised away)
    if (ch === '-') { tokens.push({ type: TK.NEG }); i++; continue; }
    if (ch === '∧' || ch === '&') { tokens.push({ type: TK.AND }); i++; continue; }
    if (ch === '∨' || ch === '|') { tokens.push({ type: TK.OR }); i++; continue; }
    if (ch === '→') { tokens.push({ type: TK.IMP }); i++; continue; }
    if (ch === '↔') { tokens.push({ type: TK.IFF }); i++; continue; }
    if (ch === '(') { tokens.push({ type: TK.LPAREN }); i++; continue; }
    if (ch === ')') { tokens.push({ type: TK.RPAREN }); i++; continue; }
    if (ch === '=') { tokens.push({ type: TK.EQ }); i++; continue; }
    if (ch === ',') { i++; continue; } // skip commas in arg lists

    // ∀ / ∃ Unicode
    if (ch === '∀') { tokens.push({ type: TK.ALL }); i++; continue; }
    if (ch === '∃') { tokens.push({ type: TK.EXI }); i++; continue; }

    // Letters
    if (/[A-Za-z]/.test(ch)) {
      // Read full identifier
      let word = '';
      while (i < s.length && /[A-Za-z0-9_'']/.test(s[i])) { word += s[i]; i++; }

      // ASCII quantifier shorthands: A/V/E followed immediately by lowercase
      // We check the word itself
      if ((word === 'A' || word === 'V') && tokens.length > 0) {
        // Could be quantifier or predicate — decide by context: if next non-space is lowercase, it's a quantifier
        const rest = s.slice(i).trimStart();
        if (rest.length > 0 && /[a-z]/.test(rest[0])) {
          tokens.push({ type: TK.ALL }); continue;
        }
      }
      // Explicit Ax / Ay / Vx / Vy etc. — full word is just quantifier+variable
      if (/^[AV][a-z][0-9_'']*$/.test(word)) {
        tokens.push({ type: TK.ALL });
        tokens.push({ type: TK.LOWER, value: word.slice(1) });
        continue;
      }
      if (/^E[a-z][0-9_'']*$/.test(word)) {
        tokens.push({ type: TK.EXI });
        tokens.push({ type: TK.LOWER, value: word.slice(1) });
        continue;
      }

      // Quantifier prefix followed by more content: AxPx, ExQy, VxRxy, AxAy...
      // Pattern: A/V/E + variable chars + uppercase (start of predicate or another quantifier)
      if (/^[AV][a-z][0-9_'']*[A-Z]/.test(word)) {
        const varMatch = word.slice(1).match(/^([a-z][0-9_'']*)(.*)$/);
        tokens.push({ type: TK.ALL });
        tokens.push({ type: TK.LOWER, value: varMatch[1] });
        word = varMatch[2];
        // If the remainder starts with another quantifier pattern, re-tokenise it recursively
        // by pushing it back as a fresh word via a helper loop — handled by fall-through below
      } else if (/^E[a-z][0-9_'']*[A-Z]/.test(word)) {
        const varMatch = word.slice(1).match(/^([a-z][0-9_'']*)(.*)$/);
        tokens.push({ type: TK.EXI });
        tokens.push({ type: TK.LOWER, value: varMatch[1] });
        word = varMatch[2];
      }

      // After a quantifier split, the remainder may itself be another quantifier (e.g. AxAy, AxEx)
      // Keep splitting until word no longer starts with a quantifier prefix
      while (/^[AV][a-z][0-9_'']*[A-Z]/.test(word)) {
        const varMatch = word.slice(1).match(/^([a-z][0-9_'']*)(.*)$/);
        tokens.push({ type: TK.ALL });
        tokens.push({ type: TK.LOWER, value: varMatch[1] });
        word = varMatch[2];
      }
      while (/^E[a-z][0-9_'']*[A-Z]/.test(word)) {
        const varMatch = word.slice(1).match(/^([a-z][0-9_'']*)(.*)$/);
        tokens.push({ type: TK.EXI });
        tokens.push({ type: TK.LOWER, value: varMatch[1] });
        word = varMatch[2];
      }
      // Also handle terminal quantifier (AV/E + var only, no more uppercase after)
      if (/^[AV][a-z][0-9_'']*$/.test(word)) {
        tokens.push({ type: TK.ALL });
        tokens.push({ type: TK.LOWER, value: word.slice(1) });
        continue;
      }
      if (/^E[a-z][0-9_'']*$/.test(word)) {
        tokens.push({ type: TK.EXI });
        tokens.push({ type: TK.LOWER, value: word.slice(1) });
        continue;
      }

      // Split predicate+args juxtaposition: Fxy -> F, x, y  or  Rxy -> R, x, y
      // Pattern: one uppercase letter followed by one or more lowercase letters (each is a variable/const)
      if (/^[A-Z][a-z]/.test(word)) {
        // First char is predicate name, rest are individual term tokens
        tokens.push({ type: TK.UPPER, value: word[0] });
        for (let k = 1; k < word.length; k++) {
          if (/[a-z]/.test(word[k])) {
            // Collect full term (may have digits/primes after)
            let term = word[k];
            // Peek ahead in word for digits/primes attached to this var
            while (k + 1 < word.length && /[0-9_'']/.test(word[k + 1])) { k++; term += word[k]; }
            tokens.push({ type: TK.LOWER, value: term });
          }
        }
        continue;
      }

      if (/^[A-Z]/.test(word)) {
        tokens.push({ type: TK.UPPER, value: word });
      } else {
        tokens.push({ type: TK.LOWER, value: word });
      }
      continue;
    }

    throw new ParseError(`Unexpected character '${ch}' — only letters, digits, and logic symbols are allowed.`);
  }

  tokens.push({ type: TK.EOF });
  return tokens;
}

class ParseError extends Error {
  constructor(msg) { super(msg); this.name = 'ParseError'; }
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() { return this.tokens[this.pos]; }
  consume() { return this.tokens[this.pos++]; }
  expect(type) {
    const t = this.peek();
    if (t.type !== type) {
      const got = t.type === TK.LOWER ? `'${t.value}'` : (TK_NAMES[t.type] || t.type);
      const exp = TK_NAMES[type] || type;
      throw new ParseError(`Expected ${exp}, but got ${got}.`);
    }
    return this.consume();
  }
  at(type) { return this.peek().type === type; }

  parse() {
    if (this.at(TK.EOF)) throw new ParseError('Empty formula — enter a formula above.');
    const node = this.parseIff();
    if (!this.at(TK.EOF)) {
      const tok = this.peek();
      const got = tok.type === TK.LOWER ? `'${tok.value}'`
                : tok.type === TK.UPPER ? `predicate '${tok.value}'`
                : (TK_NAMES[tok.type] || tok.type);
      throw new ParseError(`Unexpected ${got} after formula — did you forget a connective?`);
    }
    return node;
  }

  parseIff() {
    let left = this.parseImp();
    while (this.at(TK.IFF)) {
      this.consume();
      if (this.at(TK.EOF)) throw new ParseError('↔ must be followed by a formula on the right.');
      const right = this.parseImp();
      left = { type: 'iff', left, right };
    }
    return left;
  }

  parseImp() {
    const left = this.parseOr();
    if (this.at(TK.IMP)) {
      this.consume();
      if (this.at(TK.EOF)) throw new ParseError('→ must be followed by a formula on the right.');
      const right = this.parseImp(); // right-associative
      return { type: 'imp', left, right };
    }
    return left;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.at(TK.OR)) {
      this.consume();
      if (this.at(TK.EOF)) throw new ParseError('∨ must be followed by a formula on the right.');
      const right = this.parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNeg();
    while (this.at(TK.AND)) {
      this.consume();
      if (this.at(TK.EOF)) throw new ParseError('∧ must be followed by a formula on the right.');
      const right = this.parseNeg();
      left = { type: 'and', left, right };
    }
    return left;
  }

  parseNeg() {
    if (this.at(TK.NEG)) {
      this.consume();
      if (this.at(TK.EOF)) throw new ParseError('¬ must be followed by a formula.');
      return { type: 'neg', arg: this.parseNeg() };
    }
    return this.parseQuantified();
  }

  parseQuantified() {
    if (this.at(TK.ALL)) {
      this.consume();
      if (!this.at(TK.LOWER)) throw new ParseError('∀ must be followed by a variable (x, y, or z).');
      const v = this.expect(TK.LOWER).value;
      if (!isVariable(v)) throw new ParseError(`'${v}' is not a valid variable name. Use x, y, or z.`);
      const arg = this.parseQuantified();
      return { type: 'all', var: v, arg };
    }
    if (this.at(TK.EXI)) {
      this.consume();
      if (!this.at(TK.LOWER)) throw new ParseError('∃ must be followed by a variable (x, y, or z).');
      const v = this.expect(TK.LOWER).value;
      if (!isVariable(v)) throw new ParseError(`'${v}' is not a valid variable name. Use x, y, or z.`);
      const arg = this.parseQuantified();
      return { type: 'exi', var: v, arg };
    }
    return this.parseAtom();
  }

  parseAtom() {
    // Parenthesised formula
    if (this.at(TK.LPAREN)) {
      this.consume();
      if (this.at(TK.RPAREN)) throw new ParseError('Empty parentheses — put a formula inside ( ).');
      const inner = this.parseIff();
      if (!this.at(TK.RPAREN)) throw new ParseError('Missing closing ) — check your parentheses.');
      this.expect(TK.RPAREN);
      return inner;
    }

    // Term = term  (identity)
    if (this.at(TK.LOWER)) {
      const t1 = this.parseTerm();
      if (this.at(TK.EQ)) {
        this.consume();
        if (!this.at(TK.LOWER)) throw new ParseError('= must be followed by a term (constant or variable).');
        const t2 = this.parseTerm();
        return { type: 'eq', left: t1, right: t2 };
      }
      // Bare term — give a helpful error
      throw new ParseError(`'${t1.name}' is a term, not a formula. Did you mean a predicate like P${t1.name}?`);
    }

    // Predicate application
    if (this.at(TK.UPPER)) {
      const name = this.consume().value;
      // Parenthesised args: P(t1,t2,...)
      if (this.at(TK.LPAREN)) {
        this.consume();
        const args = [];
        if (!this.at(TK.RPAREN)) {
          args.push(this.parseTerm());
          while (this.at(TK.LOWER)) {
            args.push(this.parseTerm());
          }
        }
        if (!this.at(TK.RPAREN)) throw new ParseError(`Missing ) after argument list for ${name}(...).`);
        this.expect(TK.RPAREN);
        return { type: 'pred', name, args };
      }
      // Juxtaposed args: Pxy  or  P x y
      const args = [];
      while (this.at(TK.LOWER)) {
        args.push(this.parseTerm());
      }
      return { type: 'pred', name, args };
    }

    // Helpful error for dangling connectives
    const tok = this.peek();
    if (tok.type === TK.AND) throw new ParseError('∧ appeared where a formula was expected — missing left side?');
    if (tok.type === TK.OR)  throw new ParseError('∨ appeared where a formula was expected — missing left side?');
    if (tok.type === TK.IMP) throw new ParseError('→ appeared where a formula was expected — missing left side?');
    if (tok.type === TK.IFF) throw new ParseError('↔ appeared where a formula was expected — missing left side?');
    if (tok.type === TK.RPAREN) throw new ParseError('Unexpected ) — check your parentheses.');
    if (tok.type === TK.EOF) throw new ParseError('Formula ended unexpectedly — something is incomplete.');

    throw new ParseError(`Expected a formula or predicate, but got '${TK_NAMES[tok.type] || tok.type}'.`);
  }

  parseTerm() {
    if (this.at(TK.LOWER)) {
      const name = this.consume().value;
      return { type: 'term', name };
    }
    const tok = this.peek();
    throw new ParseError(`Expected a term (constant or variable), but got '${TK_NAMES[tok.type] || tok.type}'.`);
  }
}

// Variables are single lowercase letters x, y, z (with optional suffixes)
function isVariable(name) {
  return /^[xyz][0-9_'']*$/.test(name);
}

// Constants are a-w, or any non-xyz lowercase identifier
function isConstantName(name) {
  return /^[a-wA-Z]/.test(name) || /^[xyz][0-9_'']/.test(name);
}

function parse(input) {
  const tokens = tokenise(input);
  const p = new Parser(tokens);
  return p.parse();
}

/**
 * Collect the predicate names and their arities from an AST,
 * and variable names and constant names used.
 */
function collectSignature(ast) {
  const predicates = {}; // name -> arity
  const vars = new Set();
  const consts = new Set();

  function walk(node, boundVars) {
    if (!node) return;
    switch (node.type) {
      case 'neg': walk(node.arg, boundVars); break;
      case 'and': case 'or': case 'imp': case 'iff':
        walk(node.left, boundVars); walk(node.right, boundVars); break;
      case 'all': case 'exi':
        boundVars = new Set([...boundVars, node.var]);
        vars.add(node.var);
        walk(node.arg, boundVars); break;
      case 'pred':
        if (predicates[node.name] === undefined) predicates[node.name] = node.args.length;
        else if (predicates[node.name] !== node.args.length)
          throw new ParseError(`Predicate ${node.name} is used with ${node.args.length} argument(s) in one place and ${predicates[node.name]} in another — arity must be consistent.`);
        node.args.forEach(t => walkTerm(t, boundVars)); break;
      case 'eq':
        walkTerm(node.left, boundVars); walkTerm(node.right, boundVars); break;
    }
  }

  function walkTerm(t, boundVars) {
    if (boundVars.has(t.name)) {
      vars.add(t.name);
    } else if (isVariable(t.name)) {
      // Free variable (unbound) — goes into vars, not consts
      vars.add(t.name);
    } else {
      consts.add(t.name);
    }
  }

  walk(ast, new Set());
  return { predicates, vars, consts };
}

/**
 * Collect free variables in an AST (terms that appear outside any quantifier binding them).
 */
function collectFreeVars(ast) {
  const freeVars = new Set();

  function walk(node, boundVars) {
    if (!node) return;
    switch (node.type) {
      case 'neg': walk(node.arg, boundVars); break;
      case 'and': case 'or': case 'imp': case 'iff':
        walk(node.left, boundVars); walk(node.right, boundVars); break;
      case 'all': case 'exi': {
        const newBound = new Set([...boundVars, node.var]);
        walk(node.arg, newBound); break;
      }
      case 'pred':
        node.args.forEach(t => checkTerm(t, boundVars)); break;
      case 'eq':
        checkTerm(node.left, boundVars); checkTerm(node.right, boundVars); break;
    }
  }

  function checkTerm(t, boundVars) {
    if (isVariable(t.name) && !boundVars.has(t.name)) {
      freeVars.add(t.name);
    }
  }

  walk(ast, new Set());
  return freeVars;
}

/**
 * Pretty-print AST back to Unicode string.
 */
function prettyPrint(node, env) {
  if (!node) return '';
  switch (node.type) {
    case 'neg': return `¬${prettyAtom(node.arg, env)}`;
    case 'and': return `(${prettyPrint(node.left, env)} ∧ ${prettyPrint(node.right, env)})`;
    case 'or':  return `(${prettyPrint(node.left, env)} ∨ ${prettyPrint(node.right, env)})`;
    case 'imp': return `(${prettyPrint(node.left, env)} → ${prettyPrint(node.right, env)})`;
    case 'iff': return `(${prettyPrint(node.left, env)} ↔ ${prettyPrint(node.right, env)})`;
    case 'all': return `∀${node.var} ${prettyAtom(node.arg, env)}`;
    case 'exi': return `∃${node.var} ${prettyAtom(node.arg, env)}`;
    case 'pred':
      if (node.args.length === 0) return node.name;
      return `${node.name}${node.args.map(t => prettyPrintTerm(t, env)).join('')}`;
    case 'eq':
      return `${prettyPrintTerm(node.left, env)} = ${prettyPrintTerm(node.right, env)}`;
    default: return '?';
  }
}

// Wrap compound subformulas in parens when needed after a negation / quantifier.
// and/or/imp/iff are already wrapped by prettyPrint, so no extra parens needed.
function prettyAtom(node, env) {
  if (!node) return '';
  switch (node.type) {
    case 'neg':
    case 'pred':
    case 'eq':
    case 'all':
    case 'exi':
    case 'and':
    case 'or':
    case 'imp':
    case 'iff':
      return prettyPrint(node, env);
    default:
      return `(${prettyPrint(node, env)})`;
  }
}

function prettyPrintTerm(t, env) {
  if (!t) return '?';
  // If there is an active variable assignment, substitute the value
  if (env && env[t.name] !== undefined) return env[t.name];
  return t.name;
}
