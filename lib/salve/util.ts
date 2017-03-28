/**
 * A mock implementation of Node's util package. This module implements only
 * what is actually used in salve.
 *
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */

/**
 * A mock of Node's ``util.inspect``. The current implementation merely returns
 * what is passed to it.
 */
export function inspect(x: any): any {
  return x;
}

// LocalWords:  util Dubeau MPL Mangalam