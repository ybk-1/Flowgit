// packages/app/src (reused for the board API) is typed against the DOM; the one field it uses that
// workers-types leaves out. Workers ignore `credentials` on fetch.
interface RequestInit<Cf = CfProperties> {
  credentials?: "omit" | "same-origin" | "include";
}
