import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import esbuild from "rollup-plugin-esbuild";

export default {
  input: "src/index.ts",
  output: { file: "dist/index.js", format: "es", sourcemap: true },
  plugins: [
    nodeResolve({ preferBuiltins: true }),
    commonjs(),
    esbuild({ target: "node24" }),
  ],
};
