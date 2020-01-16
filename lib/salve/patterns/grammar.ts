/**
 * Pattern and walker for RNG's ``grammar`` elements.
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */
import { AttributeNameError, ElementNameError,
         ValidationError } from "../errors";
import { Name } from "../name_patterns";
import { NameResolver } from "../name_resolver";
import { filter, union } from "../set";
import { TrivialMap } from "../types";
import { BasePattern, EndResult, EventSet, FireEventResult,
         InternalFireEventResult, InternalWalker, Pattern } from "./base";
import { Define } from "./define";
import { Element } from "./element";
import { RefWalker } from "./ref";

/**
 * Grammar object. Users of this library normally do not create objects of this
 * class themselves but rely on the conversion facilities of salve to create
 * these objects.
 */
export class Grammar extends BasePattern {
  private readonly definitions: Map<string, Define>;
  private _elementDefinitions: TrivialMap<Element[]>;
  private _namespaces: Set<string> = new Set();
  /**
   * @param xmlPath This is a string which uniquely identifies the
   * element from the simplified RNG tree. Used in debugging.
   *
   * @param start The start pattern of this grammar.
   *
   * @param definitions An array which contain all definitions specified in this
   * grammar.
   *
   * @throws {Error} When any definition in the original
   * schema refers to a schema entity which is not defined in the schema.
   */
  constructor(public xmlPath: string, public start: Pattern,
              definitions?: Define[]) {
    super(xmlPath);

    const mapInit: [string, Define][] = [];
    if (definitions !== undefined) {
      for (const def of definitions) {
        mapInit.push([def.name, def]);
      }
    }
    this.definitions = new Map(mapInit);

    this._prepare(this.definitions, this._namespaces);
  }

  /**
   * Adds a definition.
   *
   * @param d The definition to add.
   */
  add(d: Define): void {
    this.definitions.set(d.name, d);
  }

  get elementDefinitions(): TrivialMap<Element[]> {
    const ret = this._elementDefinitions;
    if (ret !== undefined) {
      return ret;
    }

    const newDef: TrivialMap<Element[]> =
      this._elementDefinitions = Object.create(null);

    for (const def of this.definitions.values()) {
      const el = def.pat;
      const key = el.name.toString();
      if (newDef[key] === undefined) {
        newDef[key] = [el];
      }
      else {
        newDef[key].push(el);
      }
    }

    return newDef;
  }

  /**
   * @returns ``true`` if the schema is wholly context independent. This means
   * that each element in the schema can be validated purely on the basis of
   * knowing its expanded name. ``false`` otherwise.
   */
  whollyContextIndependent(): boolean {
    const defs = this.elementDefinitions;
    for (const v in defs) {
      if (defs[v].length > 1) {
        return false;
      }
    }

    return true;
  }

  /**
   * @returns An array of all namespaces used in the schema.  The array may
   * contain two special values: ``*`` indicates that there was an ``anyName``
   * element in the schema and thus that it is probably possible to insert more
   * than the namespaces listed in the array, ``::except`` indicates that an
   * ``except`` element is affecting what namespaces are acceptable to the
   * schema.
   */
  getNamespaces(): string[] {
    return Array.from(this._namespaces);
  }

  _prepare(definitions: Map<string, Define>, namespaces: Set<string>): void {
    this.start._prepare(definitions, namespaces);
    for (const d of this.definitions.values()) {
      d._prepare(definitions, namespaces);
    }
  }

  /**
   * Creates a new walker to walk this pattern.
   *
   * @returns A walker.
   */
  newWalker<NR extends NameResolver>(nameResolver: NR): GrammarWalker<NR> {
    // tslint:disable-next-line:no-use-before-declare
    return GrammarWalker.make(this, nameResolver);
  }
}

interface IWalker {
  fireEvent(name: string, params: string[],
            nameResolver: NameResolver): InternalFireEventResult;
  canEnd: boolean;
  canEndAttribute: boolean;
  end(attribute?: boolean): EndResult;
  clone(): IWalker;
  possible(): EventSet;
}

class MisplacedElementWalker implements IWalker {
  canEnd: boolean = true;
  canEndAttribute: boolean = true;

  fireEvent(name: string, params: string[]): InternalFireEventResult {
    // The strategy here is to accept everything except for elements.  The lack
    // of match that occurs on enterStartTag and startTagAndAttributes is
    // handled elsewhere.
    switch (name) {
      case "enterStartTag":
      case "startTagAndAttributes":
        return new InternalFireEventResult(false);
      default:
        return new InternalFireEventResult(true);
    }
  }

  end(): EndResult {
    return false;
  }

  possible(): EventSet {
    return new Set();
  }

  clone<T extends this>(this: T): T {
    return new (this.constructor as new (...args: unknown[]) => T)();
  }
}

/**
 * Walker for [[Grammar]].
 */
export class GrammarWalker<NR extends NameResolver> {
  private constructor(protected readonly el: Grammar,
                      readonly nameResolver: NR,
                      private elementWalkerStack: IWalker[][],
                      private misplacedDepth: number,
                      private _swallowAttributeValue: boolean,
                      private suspendedWs: string | undefined,
                      private ignoreNextWs: boolean) {
  }

  static make<NR extends NameResolver>(el: Grammar,
                                       nameResolver: NR): GrammarWalker<NR> {
    return new GrammarWalker(el,
                             nameResolver,
                             [[el.start.newWalker()]],
                             0,
                             false,
                             undefined,
                             false);
  }

  clone(): this {
    return new GrammarWalker(this.el,
                             this.nameResolver.clone(),
                             this.elementWalkerStack
                             .map(walkers => walkers.map(x => x.clone())),
                             this.misplacedDepth,
                             this._swallowAttributeValue,
                             this.suspendedWs,
                             this.ignoreNextWs) as this;
  }

  /**
   * On a [[GrammarWalker]] this method cannot return ``undefined``. An
   * undefined value would mean nothing matched, which is a validation error.
   *
   * @param name The event name.
   *
   * @param params The event parameters.
   *
   * @returns ``false`` if there is no error or an array errors.
   *
   * @throws {Error} When trying to process an event type unknown to salve.
   */
  fireEvent(name: string, params: string[]): FireEventResult {
    // Whitespaces are problematic. On the one hand, if an element may contain
    // only other elements and no text, then XML allows putting whitespace
    // between the elements. This whitespace must not cause a validation
    // error. When mixed content is possible, everywhere where text is allowed,
    // a text of length 0 is possible. (``<text/>`` does not allow specifying a
    // pattern or minimum length. And Relax NG constraints do not allow having
    // an element whose content is a mixture of ``element`` and ``data`` and
    // ``value`` that would constrain specific text patterns between the
    // elements.) We can satisfy all situations by dropping text events that
    // contain only whitespace.
    //
    // The only case where we'd want to pass a node consisting entirely of
    // whitespace is to satisfy a data or value pattern because they can require
    // a sequence of whitespaces.
    let wsMatch = true;
    switch (name) {
      case "text": {
        // Earlier versions of salve processed text events ahead of this switch
        // block, but we moved it here to improve performance. There's no issue
        // with having a case for text here because salve disallows firing more
        // than one text event in sequence.
        const text = params[0];
        // Process whitespace nodes
        if (!/\S/.test(text)) {
          if (text === "") {
            throw new Error("firing empty text events makes no sense");
          }

          // We don't check the old value of suspendedWs because salve does not
          // allow two text events in a row. So we should never have to
          // concatenate values.
          this.suspendedWs = text;

          return false;
        }
        break;
      }
      case "endTag":
        if (!this.ignoreNextWs && this.suspendedWs !== undefined) {
          wsMatch = this._fireSuspendedWsOnCurrentWalkers();
        }
        this.ignoreNextWs = true;
        break;
      default:
        this.ignoreNextWs = false;
    }
    // Absorb the whitespace: poof, gone!
    this.suspendedWs = undefined;

    // This would happen if the user puts an attribute on a tag that does not
    // allow one. Instead of generating errors for both the attribute name
    // and value, we generate an error for the name and ignore the value.
    if (this._swallowAttributeValue) {
      // Swallow only one event.
      this._swallowAttributeValue = false;
      return name === "attributeValue" ? false :
        [new ValidationError("attribute value required")];
    }

    const ret = this._fireOnCurrentWalkers(name, params);

    if (name === "endTag") {
      // We do not need to end the walkers because the fireEvent handler
      // for elements calls end when it sees an "endTag" event.
      // We do not reduce the stack to nothing.
      if (this.elementWalkerStack.length > 1) {
        this.elementWalkerStack.pop();
      }

      if (this.misplacedDepth > 0) {
        this.misplacedDepth--;
      }
    }

    if (ret.matched) {
      const { refs } = ret;
      if (refs !== undefined && refs.length !== 0) {
        this._processRefs(name, refs, params);
        return false;
      }

      // There may still have been a problem a problem with the whitespace.
      return wsMatch ? false : [new ValidationError("text not allowed here")];
    }

    return ret.errors !== undefined ? ret.errors :
      this.diagnose(name, params, wsMatch);
  }

  private diagnose(name: string, params: string[],
                   wsMatch: boolean): FireEventResult {
    switch (name) {
      case "enterStartTag":
      case "startTagAndAttributes":
        // Once in dumb mode, we remain in dumb mode.
        if (this.misplacedDepth > 0) {
          this.misplacedDepth++;
          this.elementWalkerStack.push([new MisplacedElementWalker()]);
          return wsMatch ? false :
            [new ValidationError("text not allowed here")];
        }

        const elName = new Name(params[0], params[1]);
        // Try to infer what element is meant by this errant tag. If we can't
        // find a candidate, then fall back to a dumb mode.
        const candidates = this.el.elementDefinitions[elName.toString()];
        if (candidates !== undefined && candidates.length === 1) {
          const newWalker = candidates[0].newWalker(elName);
          this.elementWalkerStack.push([newWalker]);
          if (name === "startTagAndAttributes") {
            if (!newWalker.initWithAttributes(params,
                                              this.nameResolver).matched) {
              throw new Error("internal error: the inferred element " +
                              "does not accept its initial event");
            }
          }
        }
        else {
          // Dumb mode...
          this.misplacedDepth++;
          this.elementWalkerStack.push([new MisplacedElementWalker()]);
        }
        return [new ElementNameError(
          name === "enterStartTag" ?
            "tag not allowed here" :
            "tag not allowed here with these attributes", elName)];
      case "endTag":
        return [new ElementNameError("unexpected end tag",
                                     new Name(params[0], params[1]))];
      case "attributeName":
        this._swallowAttributeValue = true;
        return [new AttributeNameError("attribute not allowed here",
                                       new Name(params[0], params[1]))];
      case "attributeNameAndValue":
        return [new AttributeNameError("attribute not allowed here",
                                       new Name(params[0], params[1]))];
      case "attributeValue":
        return [new ValidationError("unexpected attributeValue event; it \
is likely that fireEvent is incorrectly called")];
      case "text":
        return [new ValidationError("text not allowed here")];
      case "leaveStartTag":
        // If MisplacedElementWalker did not exist then we would get here if a
        // file being validated contains a tag which is not allowed. But it
        // exists, so we cannot get here. If we do end up here, then there is
        // an internal error somewhere.
        /* falls through */
      default:
        throw new Error(`unexpected event type in GrammarWalker's fireEvent: \
${name}`);
    }
  }

  // A text event either matches or does not match. It does not generate by
  // itself an error. So we do not track errors in this specialized function,
  // nor do we track references.
  private _fireSuspendedWsOnCurrentWalkers(): boolean {
    const { elementWalkerStack } = this;
    const last = elementWalkerStack.length - 1;
    const walkers = elementWalkerStack[last];

    // Checking whether walkers.length === 0 would not be a particularly useful
    // optimization, as we don't let that happen.

    // This optimization for the single walker case is significant.
    if (walkers.length === 1) {
      return walkers[0].fireEvent("text", [this.suspendedWs!],
                                  this.nameResolver).matched;
    }

    const params = [this.suspendedWs!];
    const remainingWalkers: IWalker[] = [];
    for (const walker of walkers) {
      const result = walker.fireEvent("text", params, this.nameResolver);
      // We immediately filter out results that report a match (i.e. false).
      if (result.matched) {
        remainingWalkers.push(walker);
      }
    }

    // We don't remove all walkers. If some walkers were successful and some
    // were not, then we just keep the successful ones. But removing all walkers
    // at once prevents us from giving useful error messages.
    if (remainingWalkers.length !== 0) {
      elementWalkerStack[last] = remainingWalkers;
      return true;
    }

    return false;
  }

  private _fireOnCurrentWalkers(name: string,
                                params: string[]): InternalFireEventResult {
    const { elementWalkerStack } = this;
    const last = elementWalkerStack.length - 1;
    const walkers = elementWalkerStack[last];

    // Checking whether walkers.length === 0 would not be a particularly useful
    // optimization, as we don't let that happen.

    // This optimization for the single walker case is significant.
    if (walkers.length === 1) {
      return walkers[0].fireEvent(name, params, this.nameResolver);
    }

    const errors: ValidationError[] = [];
    const refs: RefWalker[] = [];
    const remainingWalkers: IWalker[] = [];
    for (const walker of walkers) {
      const result = walker.fireEvent(name, params, this.nameResolver);
      // We immediately filter out results that report a match (i.e. false).
      if (result.matched) {
        remainingWalkers.push(walker);
        if (result.refs !== undefined) {
          refs.push(...result.refs);
        }
      }
      // There's no point in recording errors if we're going to toss them
      // anyway.
      else if ((remainingWalkers.length === 0) &&
               (result.errors !== undefined)) {
        errors.push(...result.errors);
      }
    }

    // We don't remove all walkers. If some walkers were successful and some
    // were not, then we just keep the successful ones. But removing all walkers
    // at once prevents us from giving useful error messages.
    if (remainingWalkers.length !== 0) {
      elementWalkerStack[last] = remainingWalkers;

      // If some of the walkers matched, we ignore the errors from the other
      // walkers.
      return new InternalFireEventResult(true, undefined,
                                         refs.length !== 0 ? refs : undefined);
    }

    return new InternalFireEventResult(false,
                                       errors.length !== 0 ? errors :
                                       undefined);
  }

  private _processRefs(name: string, refs: readonly RefWalker[],
                       params: string[]): void {
    const newWalkers: InternalWalker[] = [];
    const boundName = new Name(params[0], params[1]);
    if (name === "startTagAndAttributes") {
      for (const item of refs) {
        const walker = item.element.newWalker(boundName);
        // If we get anything else than false here, the internal logic is
        // wrong.
        if (!walker.initWithAttributes(params, this.nameResolver).matched) {
          throw new Error("error or failed to match on a new element \
walker: the internal logic is incorrect");
        }
        newWalkers.push(walker);
      }
    }
    else {
      for (const item of refs) {
        newWalkers.push(item.element.newWalker(boundName));
      }
    }

    this.elementWalkerStack.push(newWalkers);
  }

  canEnd(): boolean {
    const top = this.elementWalkerStack[this.elementWalkerStack.length - 1];

    return this.elementWalkerStack.length === 1 &&
      top.length > 0 && top[0].canEnd;
  }

  end(): EndResult {
    if (this.elementWalkerStack.length < 1) {
      throw new Error("stack underflow");
    }

    let finalResult: ValidationError[] = [];
    for (let ix = this.elementWalkerStack.length - 1; ix >= 0; --ix) {
      const stackElement = this.elementWalkerStack[ix];
      for (const walker of stackElement) {
        const result = walker.end();
        if (result) {
          finalResult = finalResult.concat(result);
        }
      }
    }

    return finalResult.length !== 0 ? finalResult : false;
  }

  possible(): EventSet {
    let possible: EventSet = new Set();
    for (const walker of
         this.elementWalkerStack[this.elementWalkerStack.length - 1]) {
      union(possible, walker.possible());
    }

    // If we have any attributeValue possible, then the only possible
    // events are attributeValue events.
    if (possible.size !== 0) {
      const valueEvs =
        filter(possible, ({ name }) => name === "attributeValue");

      if (valueEvs.size !== 0) {
        possible = valueEvs;
      }
    }

    return possible;
  }
}

//  LocalWords:  RNG's MPL unresolvable runtime RNG NG firstName enterContext
//  LocalWords:  leaveContext definePrefix whitespace enterStartTag endTag
//  LocalWords:  fireEvent attributeValue attributeName leaveStartTag
//  LocalWords:  misplacedElements ElementNameError GrammarWalker's
//  LocalWords:  suppressAttributes GrammarWalker
