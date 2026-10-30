import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config({ignores:['build/**','.react-router/**','node_modules/**','docs/design/**']},...tseslint.configs.recommended,{files:['app/**/*.{ts,tsx}'],plugins:{'react-hooks':hooks},rules:{...hooks.configs['recommended-latest'].rules,'@typescript-eslint/no-unused-vars':['error',{ignoreRestSiblings:true}]}});
