import * as Y from "yjs";

export function createYDoc() {
  return new Y.Doc();
}

export function getXmlFragment(doc: Y.Doc, key = "default") {
  return doc.getXmlFragment(key);
}
