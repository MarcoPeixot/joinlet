/** Tests, fixtures and build configuration are inventoried, but do not define runtime module relationships. */
export const developmentSource = (path:string) => /(?:^|\/)(?:__tests__|__fixtures__|tests?|e2e|fixtures)(?:\/|$)|\.(?:test|spec)\.[^.]+$|(?:^|\/)[^/]+\.config\.[^.]+$/.test(path);
