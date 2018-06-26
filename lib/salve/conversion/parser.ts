/**
 * This module contains classes for a conversion parser.
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */

import * as sax from "sax";

import { ValidationError } from "../errors";
import { XML1_NAMESPACE, XMLNS_NAMESPACE } from "../name_resolver";
import { Grammar, GrammarWalker } from "../patterns";
import { fixPrototype } from "../tools";
import { RELAXNG_URI } from "./simplifier/util";

/**
 * A base class for classes that perform parsing based on SAX parsers.
 *
 * Derived classes should add methods named ``on<eventname>`` so as to form a
 * full name which matches the ``on<eventname>`` methods supported by SAX
 * parsers. The constructor will attach these methods to the SAX parser passed
 * and bind them so in them ``this`` is the ``Parser`` object. This allows
 * neatly packaged methods and private parameters.
 *
 */
export class Parser {
  /**
   * @param saxParser A parser created by the ``sax-js`` library or something
   * compatible.
   */
  constructor(readonly saxParser: sax.SAXParser) {
    for (const name of sax.EVENTS) {
      const methodName = `on${name}`;
      const method = (this as any)[methodName];
      if (method !== undefined) {
        (this.saxParser as any)[methodName] =
          (this as any)[methodName].bind(this);
      }
    }
  }
}

export type ConcreteNode = Element | Text;

export abstract class Node {
  abstract readonly text: string;
  abstract readonly kind: "element" | "text";

  protected _parent: Element | undefined;

  get parent(): Element | undefined {
    return this._parent;
  }

  set parent(value: Element | undefined) {
    this.setParent(value);
  }

  protected setParent(value: Element | undefined): void {
    this._parent = value;
  }

  remove(this: ConcreteNode): void {
    const parent = this.parent;
    if (parent !== undefined) {
      parent.removeChild(this);
    }
  }

  replaceWith(this: ConcreteNode, replacement: ConcreteNode): void {
    const parent = this.parent;
    if (parent === undefined) {
      throw new Error("no parent");
    }

    parent.replaceChildWith(this, replacement);
  }
}

const emptyNS = Object.create(null);

/**
 * An Element produced by [[Parser]].
 *
 * This constructor will insert the created object into the parent automatically
 * if the parent is provided.
 */
export class Element extends Node {
  readonly kind: "element" = "element";
  /**
   * The path of the element in its tree.
   */
  private _path: string | undefined;

  prefix: string;

  local: string;

  uri: string;

  // ns is meant to be immutable.
  private readonly ns: Record<string, string>;

  attributes: Record<string, sax.QualifiedAttribute>;

  /**
   * @param node The value of the ``node`` created by the SAX parser.
   *
   * @param children The children of this element. **These children must not yet
   * be children of any element.**
   */
  constructor(prefix: string,
              local: string,
              uri: string,
              ns: Record<string, string>,
              attributes: Record<string, sax.QualifiedAttribute>,
              readonly children: ConcreteNode[] = []) {
    super();
    this.prefix = prefix;
    this.local = local;
    this.uri = uri;
    // Namespace declarations are immutable.
    this.ns = ns;
    this.attributes = attributes;

    for (const child of children) {
      child.parent = this;
    }
  }

  static fromSax(node: sax.QualifiedTag, children: ConcreteNode[]): Element {
    return new Element(
      node.prefix,
      node.local,
      node.uri,
      // We create a new object even when using a sax node. Sax uses a prototype
      // trick to flatten the hierarchy of namespace declarations but that
      // screws us over when we mutate the tree. It is simpler to just undo the
      // trick and have a resolve() method that searches up the tree. We don't
      // do that many searches anyway.
      Object.assign(Object.create(null), node.ns),
      node.attributes,
      children);
  }

  static makeElement(name: string): Element {
    return new Element(
      "",
      name,
      "",
      // We always pass the same object as ns. So we save an unnecessary object
      // creation.
      emptyNS,
      Object.create(null));
  }

  setParent(value: Element | undefined): void {
    //
    // The cost of looking for cycles is noticeable. So we should use this
    // only when debugging new code.
    //

    // let scan = value;
    // while (scan !== undefined) {
    //   if (scan === this) {
    //     throw new Error("creating reference loop!");
    //   }

    //   scan = scan.parent;
    // }

    this._path = undefined; // This becomes void.
    // We inline super.setParent here:
    this._parent = value;
  }

  resolve(name: string): string | undefined {
    if (name === "xml") {
      return XML1_NAMESPACE;
    }

    if (name === "xmlns") {
      return XMLNS_NAMESPACE;
    }

    return this._resolve(name);
  }

  _resolve(name: string): string | undefined {
    const ret = this.ns[name];

    if (ret !== undefined) {
      return ret;
    }

    return (this.parent === undefined) ? undefined : this.parent._resolve(name);
  }

  get text(): string {
    return this.children.map((x) => x.text).join("");
  }

  /**
   * A path describing the location of the element in the XML. Note that this is
   * meant to be used **only** after the simplification is complete. The value
   * is computed once and for all as soon as it is accessed.
   */
  get path(): string {
    if (this._path === undefined) {
      this._path = this.makePath();
    }

    return this._path;
  }

  private makePath(): string {
    let ret =
      `${(this.parent !== undefined) ? this.parent.path : ""}/${this.local}`;

    const name = this.getAttribute("name");
    if (name !== undefined) {
      // tslint:disable-next-line:no-string-literal
      ret += `[@name='${name}']`;
    }
    // Name classes are only valid on elements and attributes. So don't go
    // searching for it on other elements.
    else if (this.local === "element" || this.local === "attribute") {
      // By the time path is used, the name class is the first child.
      const first = this.children[0];
      if (isElement(first) && first.local === "name") {
        ret += `[@name='${first.text}']`;
      }
    }

    return ret;
  }

  removeChild(child: ConcreteNode): void {
    // We purposely don't call removeChildAt, so as to save a call.
    //
    // We don't check whether there's an element at [0]. If not, a hard fail is
    // appropriate. It shouldn't happen.
    this.children.splice(this.indexOfChild(child), 1)[0].parent = undefined;
  }

  removeChildAt(i: number): void {
    // We don't check whether there's an element at [0]. If not, a hard fail is
    // appropriate. It shouldn't happen.
    this.children.splice(i, 1)[0].parent = undefined;
  }

  replaceChildWith(child: ConcreteNode, replacement: ConcreteNode): void {
    this.replaceChildAt(this.indexOfChild(child), replacement);
  }

  replaceChildAt(i: number, replacement: ConcreteNode): void {
    const child = this.children[i];

    // In practice this is not a great optimization.
    //
    // if (child === replacement) {
    //   return;
    // }

    if (replacement.parent !== undefined) {
      replacement.parent.removeChild(replacement);
    }

    this.children[i] = replacement;
    child.parent = undefined;

    replacement.parent = this;
  }

  appendChild(child: ConcreteNode): void {
    // It is faster to use custom code than to rely on insertAt: splice
    // operations are costly.
    if (child.parent !== undefined) {
      child.parent.removeChild(child);
    }
    child.parent = this;
    this.children.push(child);
  }

  appendChildren(children: ConcreteNode[]): void {
    // It is faster to use custom code than to rely on insertAt: splice
    // operations are costly.
    for (const el of children) {
      if (el.parent !== undefined) {
        el.parent.removeChild(el);
      }
      el.parent = this;
    }
    this.children.push(...children);
  }

  prependChild(child: ConcreteNode): void {
    // It is faster to do this than to rely on insertAt: splice operations
    // are costly.
    if (child.parent !== undefined) {
      child.parent.removeChild(child);
    }
    child.parent = this;
    this.children.unshift(child);
    }

  insertAt(index: number, toInsert: ConcreteNode[]): void {
    for (const el of toInsert) {
      if (el.parent !== undefined) {
        el.parent.removeChild(el);
      }
      el.parent = this;
    }
    this.children.splice(index, 0, ...toInsert);
  }

  empty(): void {
    const children = this.children.splice(0, this.children.length);
    for (const child of children) {
      child.parent = undefined;
    }
  }

  /**
   * Gets all the children from another element and append them to this
   * element. This is a faster operation than done through other means.
   *
   * @param src The element form which to get the children.
   */
  grabChildren(src: Element): void {
    const children = src.children.splice(0, src.children.length);
    this.children.push(...children);
    for (const child of children) {
      child.parent = this;
    }
  }

  replaceContent(children: ConcreteNode[]): void {
    const prev = this.children.splice(0, this.children.length, ...children);
    for (const child of prev) {
      child.parent = undefined;
    }
    for (const child of children) {
      child.parent = this;
    }
  }

  protected indexOfChild(this: ConcreteNode, child: ConcreteNode): number {
    const parent = child.parent;
    if (parent !== this) {
      throw new Error("the child is not a child of this");
    }

    const index = parent.children.indexOf(child);
    if (index === -1) {
      throw new Error("child not among children");
    }

    return index;
  }

  /**
   * Set an attribute on an element.
   *
   * @param name The attribute name.
   *
   * @param value The new value of the attribute.
   */
  setAttribute(name: string, value: string): void {
    if (name.indexOf(":") !== -1) {
      throw new Error("we don't support namespaces on this function");
    }

    this.attributes[name] = {
      name: name,
      prefix: "",
      local: name,
      uri: "",
      value: value,
    };
  }

  setXMLNS(value: string): void {
    this.attributes.xmlns = {
      name: "xmlns",
      prefix: "xmlns",
      uri: XMLNS_NAMESPACE,
      value,
      local: "",
    };
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  getAttribute(name: string): string | undefined {
    const attr = this.attributes[name];

    return (attr !== undefined) ? attr.value : undefined;
  }

  getRawAttributes(): Record<string, sax.QualifiedAttribute> {
    return this.attributes;
  }

  mustGetAttribute(name: string): string {
    const attr = this.getAttribute(name);
    if (attr === undefined) {
      throw new Error(`no attribute named ${name}`);
    }

    return attr;
  }

  clone(): Element {
    // The strategy of pre-filling the new object and then updating the keys
    // appears to be faster than inserting new keys one by one.
    const attributes = Object.assign(Object.create(null), this.attributes);
    for (const key of Object.keys(attributes)) {
      // We do not use Object.create(null) here because there's no advantage
      // to it.
      attributes[key] = {...attributes[key]};
    }

    return new Element(
      this.prefix,
      this.local,
      this.uri,
      this.ns,
      attributes,
      this.children.map((child) => child.clone()));
  }
}

export class Text extends Node {
  readonly kind: "text" = "text";

  /**
   * @param text The textual value.
   */
  constructor(readonly text: string) {
    super();
  }

  clone(): Text {
    return new Text(this.text);
  }
}

export function isElement(node: Node): node is Element {
  return node.kind === "element";
}

export function isText(node: Node): node is Text {
  return node.kind === "text";
}

export interface ValidatorI {
  onopentag(node: sax.QualifiedTag): void;
  onclosetag(node: sax.QualifiedTag): void;
  ontext(text: string): void;
}

export class Validator implements ValidatorI {
  /** Whether we ran into an error. */
  readonly errors: ValidationError[] = [];

  /** The walker used for validating. */
  private readonly walker: GrammarWalker;

  /** The context stack. */
  private readonly contextStack: boolean[] = [];

  /** A text buffer... */
  private textBuf: string = "";

  constructor(grammar: Grammar) {
    this.walker = grammar.newWalker();
  }

  protected flushTextBuf(): void {
    if (this.textBuf === "") {
      return;
    }

    this.fireEvent("text", [this.textBuf]);
    this.textBuf = "";
  }

  protected fireEvent(name: string, args: string[]): void {
    const ret = this.walker.fireEvent(name, args);
    if (ret as boolean) {
      this.errors.push(...ret as ValidationError[]);
    }
  }

  onopentag(node: sax.QualifiedTag): void {
    this.flushTextBuf();
    let hasContext = false;
    const attributeEvents: string[] = [];
    for (const name of Object.keys(node.attributes)) {
      const { uri, prefix, local, value } = node.attributes[name];
      if ((local === "" && name === "xmlns") ||
          prefix === "xmlns") { // xmlns="..." or xmlns:q="..."
        if (!hasContext) {
          this.walker.enterContext();
          hasContext = true;
        }
        this.walker.definePrefix(local, value);
      }
      else {
        attributeEvents.push(uri, local, value);
      }
    }
    this.fireEvent("startTagAndAttributes", [node.uri, node.local,
                                             ...attributeEvents]);
    this.contextStack.unshift(hasContext);
  }

  onclosetag(node: sax.QualifiedTag): void {
    this.flushTextBuf();
    const hasContext = this.contextStack.shift();
    if (hasContext === undefined) {
      throw new Error("stack underflow");
    }

    this.fireEvent("endTag", [node.uri, node.local]);
    if (hasContext) {
      this.walker.leaveContext();
    }
  }

  ontext(text: string): void {
    this.textBuf += text;
  }
}

// A validator that does not validate.
class NullValidator implements ValidatorI {
  // tslint:disable-next-line:no-empty
  onopentag(): void {}

  // tslint:disable-next-line:no-empty
  onclosetag(): void {}

  // tslint:disable-next-line:no-empty
  ontext(): void {}
}

/**
 * A simple parser used for loading a XML document into memory.  Parsers of this
 * class use [[Node]] objects to represent the tree of nodes.
 */
export class BasicParser extends Parser {
  /**
   * The stack of elements. At the end of parsing, there should be only one
   * element on the stack, the root. This root is not an element that was in
   * the XML file but a holder for the tree of elements. It has a single child
   * which is the root of the actual file parsed.
   */
  protected readonly stack: { node: sax.QualifiedTag;
                              children: ConcreteNode[]; }[];

  protected drop: number = 0;

  constructor(saxParser: sax.SAXParser,
              protected readonly validator: ValidatorI = new NullValidator()) {
    super(saxParser);
    this.stack = [{
      // We cheat. The node field of the top level stack item won't ever be
      // accessed.
      node: undefined as any,
      children: [],
    }];
  }

  /**
   * The root of the parsed XML.
   */
  get root(): Element {
    return this.stack[0].children.filter(isElement)[0] as Element;
  }

  onopentag(node: sax.QualifiedTag): void {
    // We have to validate the node even if we are not going to record it,
    // because RelaxNG does not allow foreign nodes everywhere.
    this.validator.onopentag(node);

    // We can skip creating Element objects for foreign nodes and their
    // children.
    if (node.uri !== RELAXNG_URI || this.drop !== 0) {
      this.drop++;

      return;
    }

    this.stack.unshift({
      node,
      children: [],
    });
  }

  onclosetag(node: sax.QualifiedTag): void {
    // We have to validate the node even if we are not going to record it,
    // because RelaxNG does not allow foreign nodes everywhere.
    this.validator.onclosetag(node);

    if (this.drop !== 0) {
      this.drop--;

      return;
    }

    // tslint:disable-next-line:no-non-null-assertion
    const { node: topNode, children } = this.stack.shift()!;
    this.stack[0].children.push(Element.fromSax(topNode, children));
  }

  ontext(text: string): void {
    this.validator.ontext(text);
    if (this.drop !== 0) {
      return;
    }

    this.stack[0].children.push(new Text(text));
  }
}

/**
 * This parser is specifically dedicated to the task of reading simplified Relax
 * NG schemas. In a Relax NG schema, text nodes that consist entirely of white
 * space are expandable, except in the ``param`` and ``value`` elements, where
 * they do potentially carry significant information.
 *
 * This parser strips nodes that consist entirely of white space because this
 * simplifies code that needs to process the resulting tree, but preserve those
 * nodes that are potentially significant.
 *
 * This parser does not allow elements which are not in the Relax NG namespace.
 */
export class ConversionParser extends BasicParser {
  onopentag(node: sax.QualifiedTag): void {
    // tslint:disable-next-line: no-http-string
    if (node.uri !== "http://relaxng.org/ns/structure/1.0") {
      throw new Error(`node in unexpected namespace: ${node.uri}`);
    }

    super.onopentag(node);
  }

  ontext(text: string): void {
    // We ignore text appearing before or after the top level element.
    if (this.stack.length <= 1 || this.drop !== 0) {
      return;
    }

    const top = this.stack[0];
    const local = top.node.local;
    // The parser does not allow non-RNG nodes, so we don't need to check the
    // namespace.
    const keepWhitespaceNodes = local === "param" || local === "value";

    if (keepWhitespaceNodes || text.trim() !== "") {
      super.ontext(text);
    }
  }
}

// Exception used to terminate the sax parser early.
export class Found extends Error {
  constructor() {
    super();
    fixPrototype(this, Found);
  }
}

export class IncludeParser extends Parser {
  found: boolean;

  constructor(saxParser: sax.SAXParser) {
    super(saxParser);
    this.found = false;
  }

  onopentag(node: sax.QualifiedTag): void {
    // tslint:disable-next-line:no-http-string
    if (node.uri === "http://relaxng.org/ns/structure/1.0" &&
        (node.local === "include" || node.local === "externalRef")) {
      this.found = true;
      throw new Found();  // Stop early.
    }
  }
}

//  LocalWords:  MPL NG param RNG
