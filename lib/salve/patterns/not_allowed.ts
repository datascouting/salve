/**
 * Pattern and walker for RNG's ``notAllowed`` elements.
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */
import { EndResult, EventSet, InternalFireEventResult, InternalWalker,
         Pattern } from "./base";

/**
 * Pattern for ``<notAllowed/>``.
 */
export class NotAllowed extends Pattern {
  newWalker(): NotAllowedWalker {
    // tslint:disable-next-line:no-use-before-declare
    return singleton;
  }
}

/**
 * Walker for [[NotAllowed]];
 */
export class NotAllowedWalker implements InternalWalker {
  protected readonly el: NotAllowed;
  canEnd: boolean;
  canEndAttribute: boolean;

  /**
   * @param el The pattern for which this walker was created.
   */
  constructor(el: NotAllowed) {
    this.el = el;
    this.canEnd = true;
    this.canEndAttribute = true;
  }

  // Since NotAllowedWalker is a singleton, the cloning operation just
  // returns the original walker.
  clone(): this {
    return this;
  }

  possible(): EventSet {
    return new Set();
  }

  possibleAttributes(): EventSet {
    return new Set();
  }

  fireEvent(): InternalFireEventResult {
    return new InternalFireEventResult(false); // we never match!
  }

  end(): EndResult {
    return false;
  }

  endAttributes(): EndResult {
    return false;
  }
}

const singleton = new NotAllowedWalker(new NotAllowed("FAKE ELEMENT"));

//  LocalWords:  RNG's MPL possibleCached
