const fs = require('fs');
const path = require('path');
const babel = require('@babel/parser');
const generate = require('@babel/generator').default;
const babelPresetTypeScript = require('@babel/preset-typescript');
const traverse = require('@babel/traverse').default;
const types = require('@babel/types');
const { getConfig: buildAndGetConfig } = require('./buildConfig');

let ConfigDefault = {};

let configFile;

const {
  convertStyledToStyledVerbosed,
  convertSxToSxVerbosed,
} = require('@gluestack-style/react/lib/commonjs/convertSxToSxVerbosed');
const {
  propertyTokenMap,
} = require('@gluestack-style/react/lib/commonjs/propertyTokenMap');
const {
  stableHash,
} = require('@gluestack-style/react/lib/commonjs/stableHash');
const {
  CSSPropertiesMap,
  reservedKeys,
} = require('@gluestack-style/react/lib/commonjs/core/styled-system');
const {
  StyleInjector,
} = require('@gluestack-style/react/lib/commonjs/style-sheet/index');
const {
  updateOrderUnResolvedMap,
} = require('@gluestack-style/react/lib/commonjs/updateOrderUnResolvedMap');
const { deepMerge } = require('@gluestack-style/react/lib/commonjs/utils');
const {
  setObjectKeyValue,
} = require('@gluestack-style/react/lib/commonjs/core/utils');
const {
  checkAndReturnUtilityProp,
} = require('@gluestack-style/react/lib/commonjs/core/convert-utility-to-sx');

let configThemePath = [];
const BUILD_TIME_GLUESTACK_STYLESHEET = new StyleInjector();

function getConfigPath() {
  const isConfigJSExist = fs.existsSync(
    path.join(process.cwd(), './gluestack-style.config.js')
  );
  const isGlueStackUIConfigJSExist = fs.existsSync(
    path.join(process.cwd(), './gluestack-ui.config.js')
  );
  const isConfigTSExist = fs.existsSync(
    path.join(process.cwd(), './gluestack-style.config.ts')
  );
  const isGlueStackUIConfigTSExist = fs.existsSync(
    path.join(process.cwd(), './gluestack-ui.config.ts')
  );

  if (isConfigJSExist) return './gluestack-style.config.js';
  if (isConfigTSExist) return './gluestack-style.config.ts';
  if (isGlueStackUIConfigJSExist) return './gluestack-ui.config.js';
  if (isGlueStackUIConfigTSExist) return './gluestack-ui.config.ts';
}

const convertExpressionContainerToStaticObject = (
  properties,
  result = {},
  keyPath = [],
  propsToBePersist = {}
) => {
  properties?.forEach((property, index) => {
    const nodeName = property.key.name ?? property.key.value;
    if (property.value.type === 'ObjectExpression') {
      keyPath.push(nodeName);
      convertExpressionContainerToStaticObject(
        property.value.properties,
        result,
        keyPath,
        propsToBePersist
      );
      keyPath.pop();
    } else if (property.value.type === 'Identifier') {
      if (property.key.value) {
        setObjectKeyValue(
          propsToBePersist,
          [...keyPath, nodeName],
          property.value.name
        );
      }
      if (property.key.name) {
        setObjectKeyValue(
          propsToBePersist,
          [...keyPath, nodeName],
          property.value.name
        );
      }
    } else {
      if (property.key.value) {
        setObjectKeyValue(
          result,
          [...keyPath, property.key.value],
          property.value.value
        );
      }

      if (property.key.name) {
        setObjectKeyValue(
          result,
          [...keyPath, property.key.name],
          property.value.value
        );
      }
    }
  });
  return {
    result,
    propsToBePersist,
  };
};

function findThemeAndComponentConfig(node) {
  let themeNode = null;
  let componentConfigNode = null;
  node.forEach((prop) => {
    const propKey = prop.key.name ? prop.key.name : prop.key.value;
    if (propKey === 'theme') {
      themeNode = prop;
    } else if (propKey === 'componentConfig') {
      componentConfigNode = prop;
    }
  });

  return {
    themeNode,
    componentConfigNode,
  };
}

function addQuotesToObjectKeys(code) {
  const ast = babel.parse(`var a = ${code}`, {
    presets: [babelPresetTypeScript],
    plugins: ['typescript'],
    sourceType: 'module',
  });

  traverse(ast, {
    ObjectProperty: (objectPropertyPath) => {
      if (types.isTemplateLiteral(objectPropertyPath.node.value)) {
        objectPropertyPath.node.value = types.stringLiteral(
          objectPropertyPath.node.value.quasis[0].value.raw
        );
      }
      if (types.isIdentifier(objectPropertyPath.node.key)) {
        objectPropertyPath.node.key = types.stringLiteral(
          objectPropertyPath.node.key.name
        );
      }
      if (types.isNumericLiteral(objectPropertyPath.node.key)) {
        objectPropertyPath.node.key = types.stringLiteral(
          objectPropertyPath.node.key.extra.raw
        );
      }
      if (types.isStringLiteral(objectPropertyPath.node.value)) {
        objectPropertyPath.node.value = types.stringLiteral(
          objectPropertyPath.node.value.value
        );
      }
    },
  });

  let initAst;

  traverse(ast, {
    ObjectProperty: (objectPropertyPath) => {
      if (types.isArrayExpression(objectPropertyPath?.node?.value)) {
        let arrayElements = objectPropertyPath.node.value.elements;
        const dynamicElementsIndex = [];
        arrayElements.forEach((element, index) => {
          if (
            types.isNewExpression(element) ||
            types.isIdentifier(element) ||
            types.isTemplateLiteral(element)
          ) {
            dynamicElementsIndex.push(index);
          }
        });

        arrayElements = arrayElements.filter(
          (element, index) => !dynamicElementsIndex.includes(index)
        );
        objectPropertyPath.node.value.elements = arrayElements;
      } else if (
        types.isIdentifier(objectPropertyPath?.node?.value) ||
        types.isTemplateLiteral(objectPropertyPath?.node?.value) ||
        types.isConditionalExpression(objectPropertyPath?.node?.value)
      ) {
        objectPropertyPath.remove();
      }
    },
  });

  traverse(ast, {
    VariableDeclarator: (variableDeclaratorPath) => {
      initAst = variableDeclaratorPath.node.init;
    },
  });

  const { code: output } = generate(initAst, {
    sourceType: 'module',
    presets: [babelPresetTypeScript],
    plugins: ['typescript'],
  });

  return output;
}
const merge = require('lodash.merge');
const { exit } = require('process');
const checkIfPathIsAbsolute = (path) => {
  return path.startsWith('/');
};
function getConfig(configPath) {
  if (configPath) {
    return fs.readFileSync(
      path.join(
        !checkIfPathIsAbsolute(configPath) ? process.cwd() : '',
        configPath
      ),
      'utf8'
    );
  }
  const isConfigJSExist = fs.existsSync(
    path.join(process.cwd(), './gluestack-style.config.js')
  );
  const isGlueStackUIConfigJSExist = fs.existsSync(
    path.join(process.cwd(), './gluestack-ui.config.js')
  );
  const isConfigTSExist = fs.existsSync(
    path.join(process.cwd(), './gluestack-style.config.ts')
  );
  const isGlueStackUIConfigTSExist = fs.existsSync(
    path.join(process.cwd(), './gluestack-ui.config.ts')
  );

  if (isConfigTSExist) {
    return fs.readFileSync(
      path.join(process.cwd(), './gluestack-style.config.ts'),
      'utf8'
    );
  }

  if (isConfigJSExist) {
    return fs.readFileSync(
      path.join(process.cwd(), './gluestack-style.config.js'),
      'utf8'
    );
  }
  if (isGlueStackUIConfigJSExist) {
    return fs.readFileSync(
      path.join(process.cwd(), './gluestack-ui.config.js'),
      'utf8'
    );
  }
  if (isGlueStackUIConfigTSExist) {
    return fs.readFileSync(
      path.join(process.cwd(), './gluestack-ui.config.ts'),
      'utf8'
    );
  }
}

function getBuildTimeParams(
  theme,
  componentConfig,
  extendedConfig,
  outputLibrary,
  platform,
  type
) {
  let mergedPropertyConfig = {
    ...ConfigDefault?.propertyTokenMap,
    ...propertyTokenMap,
  };
  let componentExtendedConfig = merge(
    {},
    {
      ...ConfigDefault,
      propertyTokenMap: { ...mergedPropertyConfig },
    }
  );

  if (theme && Object.keys(theme).length > 0) {
    const verbosedTheme = convertStyledToStyledVerbosed(theme);

    let componentHash = stableHash({
      ...theme,
      ...componentConfig,
    });

    if (outputLibrary) {
      componentHash = outputLibrary + '-' + componentHash;
    }

    const { styledIds, verbosedStyleIds } = updateOrderUnResolvedMap(
      verbosedTheme,
      componentHash,
      type,
      componentConfig,
      BUILD_TIME_GLUESTACK_STYLESHEET,
      platform
    );

    const toBeInjected = BUILD_TIME_GLUESTACK_STYLESHEET.resolve(
      styledIds,
      componentExtendedConfig,
      {}
    );

    const current_global_map = BUILD_TIME_GLUESTACK_STYLESHEET.getStyleMap();

    const orderedResolvedTheme = [];

    current_global_map?.forEach((styledResolved) => {
      if (styledIds.includes(styledResolved?.meta?.cssId)) {
        orderedResolvedTheme.push(styledResolved);
      }
    });

    const styleIdsAst = generateObjectAst(verbosedStyleIds);

    const toBeInjectedAst = generateObjectAst(toBeInjected);

    const orderedResolvedAst = generateArrayAst(orderedResolvedTheme);

    const orderedStyleIdsArrayAst = types.arrayExpression(
      styledIds?.map((cssId) => types.stringLiteral(cssId))
    );

    const resultParamsNode = types.objectExpression([
      types.objectProperty(
        types.stringLiteral('orderedResolved'),
        orderedResolvedAst
      ),
      types.objectProperty(
        types.stringLiteral('toBeInjected'),
        toBeInjectedAst
      ),
      types.objectProperty(
        types.stringLiteral('styledIds'),
        orderedStyleIdsArrayAst
      ),
      types.objectProperty(
        types.stringLiteral('verbosedStyleIds'),
        styleIdsAst
      ),
    ]);
    return resultParamsNode;
  }
  return null;
}

function replaceSingleQuotes(str) {
  let inDoubleQuotes = false;
  let newStr = '';
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '"') {
      inDoubleQuotes = !inDoubleQuotes;
    }
    if (str[i] === "'" && !inDoubleQuotes) {
      newStr += '"';
    } else {
      newStr += str[i];
    }
  }
  return newStr;
}

function getObjectFromAstNode(node) {
  let objectCode = generate(node).code;

  objectCode = objectCode?.replace(/as const/g, '');

  objectCode = addQuotesToObjectKeys(
    objectCode.replace(
      /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g,
      (m, g) => (g ? '' : m)
    )
  );
  // Checking for single quotes and replacing it with " while keeping in mind to not replace single quotes inside double quotes
  objectCode = replaceSingleQuotes(objectCode);
  // console.log(objectCode, ' <==================|++++>> object code');

  return JSON.parse(objectCode);
}

function removeLiteralPropertiesFromObjectProperties(code) {
  const ast = babel.parse(`var a = ${code}`, {
    presets: [babelPresetTypeScript],
    plugins: ['typescript'],
    sourceType: 'module',
  });

  traverse(ast, {
    ObjectExpression: (path) => {
      path.traverse({
        ObjectProperty(path) {
          const { value } = path.node;

          path.traverse({
            StringLiteral: (stringPath) => {
              stringPath;
            },
          });

          if (
            value.type === 'StringLiteral' ||
            value.type === 'NumericLiteral'
          ) {
            path.remove();
          }
        },
      });
    },
  });

  let initAst;
  // let modifiedAst = undefined;

  // traverse(ast, {
  //   ObjectProperty: (path) => {
  //     if (!modifiedAst) {
  //       modifiedAst = removeEmptyProperties(path.node);
  //       path.node = modifiedAst;
  //     }
  //   },
  // });

  traverse(ast, {
    VariableDeclarator: (path) => {
      initAst = path.node.init;
    },
  });

  return initAst;
}

function getIdentifiersObjectFromAstNode(node) {
  let objectCode = generate(node).code;

  return removeLiteralPropertiesFromObjectProperties(
    objectCode.replace(
      /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g,
      (m, g) => (g ? '' : m)
    )
  );
}

function generateObjectAst(obj) {
  let properties = Object.entries(obj).map(([key, value]) => {
    if (typeof value === 'undefined') {
      return;
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      return types.objectProperty(
        types.stringLiteral(key),
        generateObjectAst(value)
      );
    } else if (typeof value === 'object' && Array.isArray(value)) {
      let elements = value.map((obj) => {
        if (typeof obj === 'string') {
          return types.stringLiteral(obj);
        } else {
          return generateObjectAst(obj);
        }
      });
      return types.objectProperty(
        types.stringLiteral(key),
        types.arrayExpression(elements)
      );
    } else if (typeof value === 'boolean') {
      return types.objectProperty(
        types.stringLiteral(key),
        types.booleanLiteral(value)
      );
    } else {
      return types.objectProperty(
        types.stringLiteral(key),
        typeof value === 'number'
          ? types.numericLiteral(value)
          : types.stringLiteral(value)
      );
    }
  });

  return types.objectExpression(properties.filter((property) => property));
}
function generateArrayAst(arr) {
  return types.arrayExpression(arr.map((obj) => generateObjectAst(obj)));
}

function isImportedFromLibrary(libraries, importName) {
  if (libraries.includes(importName)) {
    return true;
  }
  return false;
}

function isImportFromAbsolutePath(
  absolutePaths,
  filePath,
  importedAbsolutePath
) {
  filePath.pop();

  const finalAbsolutePath = path.resolve(
    filePath.join('/'),
    importedAbsolutePath
  );
  if (absolutePaths.includes(finalAbsolutePath)) {
    return true;
  }
  return false;
}

module.exports = function (b) {
  try {
    const { types: t } = b;
    const mockPath = path.join(
      process.cwd(),
      `.gluestack/mock-${process.ppid}.js`
    );
    const isConfigExist = fs.existsSync(mockPath);

    if (!isConfigExist) {
      const outputDir = `.gluestack/config-${process.ppid}.js`;
      const inputDir = getConfigPath();

      if (!fs.existsSync(path.join(process.cwd(), outputDir))) {
        configFile = buildAndGetConfig(inputDir, outputDir);
      }
      if (inputDir) {
        ConfigDefault = configFile?.config;
      }
    } else {
      const configPath = path.join(
        process.cwd(),
        `.gluestack/config-${process.ppid}.js`
      );

      if (fs.existsSync(configPath)) {
        configFile = require(configPath);
        ConfigDefault = configFile?.config;
      }
    }

    function checkWebFileExists(filePath) {
      if (filePath.includes('node_modules')) {
        return false;
      }
      const ext = path.extname(filePath);
      const dirname = path.dirname(filePath);
      const basename = path.basename(filePath, ext);
      const webFilePath = path.join(dirname, `${basename}.web${ext}`);
      return fs.existsSync(webFilePath);
    }

    let styledImportName = '';
    let styledAlias = '';
    let styledAliasImportedName = '';
    let tempPropertyResolverNode;
    let platform = 'all';
    let currentFileName = 'file not found!';
    let configPath;
    let outputLibrary;
    let componentSXProp;
    const guessingStyledComponents = [];
    const styled = ['@gluestack-style/react', '@gluestack-ui/themed'];
    const components = ['@gluestack-ui/themed'];
    let isStyledPathConfigured = false;
    let isComponentsPathConfigured = false;
    let targetPlatform = process.env.GLUESTACK_STYLE_TARGET;
    let createStyleImportedName = '';
    let createComponentsImportedName = '';
    const CREATE_STYLE = 'createStyle';
    const CREATE_COMPONENTS = 'createComponents';

    return {
      name: 'gluestack-babel-styled-resolver', // not required
      pre(state) {
        let plugin;

        state?.opts?.plugins?.forEach((currentPlugin) => {
          if (currentPlugin.key === 'gluestack-babel-styled-resolver') {
            plugin = currentPlugin;
          }
        });

        if (plugin?.options?.configPath) {
          configPath = plugin?.options?.configPath;
        }

        if (plugin?.options?.configThemePath) {
          configThemePath = plugin?.options?.configThemePath;
        }

        if (configPath) {
          const outputDir = `.gluestack/config-${process.ppid + 1}.js`;
          const mockLibraryPath = `./mock-${process.ppid + 1}.js`;

          if (!fs.existsSync(path.join(process.cwd(), mockLibraryPath))) {
            configFile = buildAndGetConfig(
              configPath,
              outputDir,
              mockLibraryPath
            );

            if (configThemePath.length > 0) {
              configThemePath.forEach((path) => {
                configFile = configFile?.[path];
              });
              configThemePath = [];
              ConfigDefault = configFile;
            } else {
              ConfigDefault = configFile?.config;
            }
          } else {
            const configPath = path.join(process.cwd(), outputDir);

            if (fs.existsSync(configPath)) {
              configFile = require(configPath);
              if (configThemePath.length > 0) {
                configThemePath.forEach((path) => {
                  configFile = configFile?.[path];
                });
                configThemePath = [];
                ConfigDefault = configFile;
              } else {
                ConfigDefault = configFile?.config;
              }
            }
          }
        }
      },
      visitor: {
        ImportDeclaration(importPath, state) {
          currentFileName = state.file.opts.filename;
          styledAlias = state?.opts?.styledAlias;
          outputLibrary = state?.opts?.outputLibrary || outputLibrary;

          if (state?.opts?.platform) {
            platform = state?.opts?.platform;
          } else {
            platform = 'all';
          }

          if (!currentFileName.includes('node_modules')) {
            if (currentFileName.includes('.web.')) {
              platform = 'web';
            } else if (checkWebFileExists(currentFileName)) {
              platform = 'native';
            }
          }

          if (
            state?.opts?.styled &&
            Array.isArray(state?.opts?.styled) &&
            !isStyledPathConfigured
          ) {
            styled.push(...state?.opts?.styled);
            isStyledPathConfigured = true;
          }

          if (
            state?.opts?.components &&
            Array.isArray(state?.opts?.components) &&
            !isComponentsPathConfigured
          ) {
            components.push(...state?.opts?.components);
            isComponentsPathConfigured = true;
          }

          const importName = importPath.node.source.value;

          let filePath = state.file.opts.filename.split('/');

          if (
            isImportFromAbsolutePath(components, filePath, importName) ||
            isImportedFromLibrary(components, importName)
          ) {
            importPath.traverse({
              ImportSpecifier(importSpecifierPath) {
                guessingStyledComponents.push(
                  importSpecifierPath.node.local.name
                );
              },
            });
          }

          if (
            isImportFromAbsolutePath(styled, filePath, importName) ||
            isImportedFromLibrary(styled, importName)
          ) {
            importPath.traverse({
              ImportSpecifier(importSpecifierPath) {
                if (importSpecifierPath.node.imported.name === 'styled') {
                  styledImportName = importSpecifierPath.node.local.name;
                }
                if (importSpecifierPath.node.imported.name === CREATE_STYLE) {
                  createStyleImportedName = importSpecifierPath.node.local.name;
                }
                if (
                  importSpecifierPath.node.imported.name === CREATE_COMPONENTS
                ) {
                  createComponentsImportedName =
                    importSpecifierPath.node.local.name;
                }
                if (importSpecifierPath.node.imported.name === styledAlias) {
                  styledAliasImportedName = importSpecifierPath.node.local.name;
                }
              },
            });
          }
        },
        AssignmentExpression(expressionPath, state) {
          if (
            expressionPath?.node?.right?.callee?.name ===
              styledAliasImportedName ||
            expressionPath?.node?.right?.callee?.name === styledImportName
          ) {
            let componentName = expressionPath?.parent?.id?.name;

            if (componentName) {
              guessingStyledComponents.push(componentName);
            }
          }
        },
        CallExpression(callExpressionPath, state) {
          if (!state.file.opts.filename?.includes('node_modules')) {
            const calleeName = callExpressionPath.node.callee.name;
            if (
              calleeName === styledAliasImportedName ||
              calleeName === styledImportName ||
              calleeName === createComponentsImportedName ||
              calleeName === createStyleImportedName
            ) {
              callExpressionPath.traverse({
                ObjectProperty(ObjectPath) {
                  if (t.isIdentifier(ObjectPath.node.value)) {
                    if (ObjectPath.node.value.name === 'undefined') {
                      ObjectPath.remove();
                    }
                  }
                },
              });
            }
            if (
              calleeName === styledAliasImportedName ||
              calleeName === styledImportName
            ) {
              let componentName = callExpressionPath?.parent?.id?.name;

              if (componentName) {
                guessingStyledComponents.push(componentName);
              }

              let args = callExpressionPath.node.arguments;

              let componentThemeNode = args[1];
              // optional case
              let componentConfigNode = args[2] ?? t.objectExpression([]);
              let extendedThemeNode = args[3] ?? t.objectExpression([]);

              if (
                !(
                  t.isIdentifier(componentThemeNode) ||
                  t.isIdentifier(componentConfigNode) ||
                  t.isIdentifier(extendedThemeNode)
                )
              ) {
                // args[1] = t.objectExpression([]);

                let extendedThemeNodeProps = [];
                if (extendedThemeNode && extendedThemeNode?.properties) {
                  extendedThemeNode?.properties.forEach((prop) => {
                    if (prop.key.name === 'propertyResolver') {
                      tempPropertyResolverNode = prop;
                    } else {
                      extendedThemeNodeProps.push(prop);
                    }
                  });
                  extendedThemeNode.properties = extendedThemeNodeProps;
                }

                let theme = getObjectFromAstNode(componentThemeNode);
                let ExtendedConfig = getObjectFromAstNode(extendedThemeNode);
                let componentConfig = getObjectFromAstNode(componentConfigNode);

                if (extendedThemeNode && tempPropertyResolverNode) {
                  extendedThemeNode.properties.push(tempPropertyResolverNode);
                }

                const resultParamsNode = getBuildTimeParams(
                  theme,
                  componentConfig,
                  ExtendedConfig,
                  outputLibrary,
                  platform,
                  'boot'
                );

                if (resultParamsNode) {
                  while (args.length < 4) {
                    args.push(t.objectExpression([]));
                  }
                  if (!args[4]) {
                    args.push(resultParamsNode);
                  } else {
                    args[4] = resultParamsNode;
                  }
                }
              }

              // console.log(
              //   '<==================|++++>> final ',
              //   generate(path.node).code
              // );
              // console.log(
              //   args,
              //   // resolvedStyles,
              //   // orderedResolved,
              //   // ...path.node.arguments,
              //   // generate(resultParamsNode).code,
              //   // resultParamsNode,
              //   // generate(path.node).code,
              //   'code'
              // );
              // console.log('\n\n >>>>>>>>>>>>>>>>>>>>>\n');

              // console.log('final', generate(path.node).code);
              // console.log('\n >>>>>>>>>>>>>>>>>>>>>\n\n');
            }
            if (calleeName === createStyleImportedName) {
              let args = callExpressionPath.node.arguments;

              let componentThemeNode = args[0];
              let componentConfigNode = args[1] ?? t.objectExpression([]);

              if (
                !(
                  t.isIdentifier(componentThemeNode) ||
                  t.isIdentifier(componentConfigNode)
                )
              ) {
                let theme = getObjectFromAstNode(componentThemeNode);
                let componentConfig = getObjectFromAstNode(componentConfigNode);

                const resultParamsNode = getBuildTimeParams(
                  theme,
                  componentConfig,
                  {},
                  outputLibrary,
                  platform,
                  'extended'
                );

                if (resultParamsNode) {
                  while (args.length < 3) {
                    args.push(t.objectExpression([]));
                  }
                  if (!args[2]) {
                    args.push(resultParamsNode);
                  } else {
                    args[2] = resultParamsNode;
                  }
                }
              }
            }
            if (calleeName === createComponentsImportedName) {
              /*
          extended theme components AST
          {
            box: {
              theme: {},
            },
            button: {
              theme: {},
            },
          }
          */
              const extendedThemeComponents =
                callExpressionPath.node.arguments[0].properties;

              if (Array.isArray(extendedThemeComponents)) {
                extendedThemeComponents.forEach((property) => {
                  if (
                    !t.isIdentifier(property.value) &&
                    !t.isTemplateLiteral(property.value) &&
                    !t.isConditionalExpression(property.value)
                  ) {
                    const { themeNode, componentConfigNode } =
                      findThemeAndComponentConfig(property.value.properties);

                    let theme = themeNode
                      ? getObjectFromAstNode(themeNode?.value)
                      : {};
                    let componentConfig = componentConfigNode
                      ? getObjectFromAstNode(componentConfigNode?.value)
                      : {};

                    const resultParamsNode = getBuildTimeParams(
                      theme,
                      componentConfig,
                      {},
                      outputLibrary,
                      platform,
                      'extended'
                    );

                    if (resultParamsNode) {
                      property.value.properties.push(
                        t.objectProperty(
                          t.stringLiteral('BUILD_TIME_PARAMS'),
                          resultParamsNode
                        )
                      );
                    }
                  }
                });
              }
            }
          }
        },
        JSXOpeningElement(jsxOpeningElementPath) {
          if (
            jsxOpeningElementPath.node.name &&
            jsxOpeningElementPath.node.name.name &&
            guessingStyledComponents.includes(
              jsxOpeningElementPath.node.name.name
            )
          ) {
            const propsToBePersist = [];
            let sxPropsWithIdentifier = {};

            const mergedPropertyConfig = {
              ...ConfigDefault?.propertyTokenMap,
              ...propertyTokenMap,
            };

            const styledSystemProps = {
              ...CSSPropertiesMap,
              ...ConfigDefault?.aliases,
            };

            const componentExtendedConfig = merge(
              {},
              {
                ...ConfigDefault,
                propertyTokenMap: { ...mergedPropertyConfig },
              }
            );

            let sxPropsConvertedUtilityProps = {};

            const prefixedMediaQueries = {};

            if (componentExtendedConfig?.tokens?.mediaQueries) {
              Object.keys(
                componentExtendedConfig?.tokens?.mediaQueries
              ).forEach((key) => {
                prefixedMediaQueries[key] = {
                  key: `@${key}`,
                  isMediaQuery: true,
                };
              });

              Object.assign(reservedKeys, { ...prefixedMediaQueries });
            }

            const attr = jsxOpeningElementPath?.node?.attributes;
            attr.forEach((attribute, index) => {
              if (t.isJSXAttribute(attribute)) {
                const propName = attribute?.name?.name;
                const propValue = attribute?.value;

                if (t.isJSXExpressionContainer(propValue)) {
                  if (
                    t.isIdentifier(propValue.expression) ||
                    t.isConditionalExpression(propValue.expression)
                  ) {
                    propsToBePersist.push(attribute);
                  } else if (
                    t.isObjectExpression(propValue.expression) &&
                    propName !== 'sx'
                  ) {
                    const utilityPropsWithIdentifier =
                      getIdentifiersObjectFromAstNode(propValue.expression);

                    const objectProperties = propValue.expression.properties;
                    const { result: objectValue } =
                      convertExpressionContainerToStaticObject(
                        objectProperties
                      );

                    const {
                      prop: propString,
                      propPath,
                      value: utilityPropValue,
                    } = checkAndReturnUtilityProp(
                      propName,
                      objectValue,
                      styledSystemProps,
                      [],
                      reservedKeys
                    );

                    if (propString) {
                      propsToBePersist.push(attribute);
                    } else {
                      if (propPath && propPath.length > 0) {
                        setObjectKeyValue(
                          sxPropsConvertedUtilityProps,
                          propPath,
                          utilityPropValue
                        );

                        if (
                          utilityPropsWithIdentifier &&
                          utilityPropsWithIdentifier.properties &&
                          utilityPropsWithIdentifier.properties.length > 0
                        ) {
                          propsToBePersist.push(
                            t.jsxAttribute(
                              t.jsxIdentifier(propName),
                              t.jsxExpressionContainer(
                                utilityPropsWithIdentifier
                              )
                            )
                          );
                        }
                      }
                    }
                  } else {
                    if (propName === 'sx') {
                      const objectProperties = propValue.expression.properties;

                      sxPropsWithIdentifier = getIdentifiersObjectFromAstNode(
                        propValue.expression
                      );

                      const { result: sxPropsObject } =
                        convertExpressionContainerToStaticObject(
                          objectProperties
                        );
                      componentSXProp = sxPropsObject;
                    } else if (
                      t.isStringLiteral(propValue.expression) ||
                      t.isNumericLiteral(propValue.expression)
                    ) {
                      const {
                        prop: propString,
                        propPath,
                        value: utilityPropValue,
                      } = checkAndReturnUtilityProp(
                        propName,
                        propValue.expression.value,
                        styledSystemProps,
                        [],
                        reservedKeys
                      );

                      if (propString) {
                        propsToBePersist.push(attribute);
                      } else {
                        if (propPath && propPath.length > 0) {
                          setObjectKeyValue(
                            sxPropsConvertedUtilityProps,
                            propPath,
                            utilityPropValue
                          );
                        }
                      }
                    } else {
                      propsToBePersist.push(attribute);
                    }
                  }
                } else {
                  const {
                    prop: propString,
                    propPath,
                    value: utilityPropValue,
                  } = checkAndReturnUtilityProp(
                    propName,
                    propValue?.value,
                    styledSystemProps,
                    [],
                    reservedKeys
                  );
                  if (propString) {
                    propsToBePersist.push(attribute);
                  } else {
                    if (propPath && propPath.length > 0) {
                      setObjectKeyValue(
                        sxPropsConvertedUtilityProps,
                        propPath,
                        utilityPropValue
                      );
                    }
                  }
                }
              }
            });

            jsxOpeningElementPath.node.attributes.splice(
              0,
              jsxOpeningElementPath.node.attributes.length
            );

            jsxOpeningElementPath.node.attributes = propsToBePersist;

            const sx = deepMerge(
              { ...sxPropsConvertedUtilityProps },
              { ...componentSXProp }
            );
            if (Object.keys(sx).length > 0) {
              const verbosedSx = convertSxToSxVerbosed(sx);

              const inlineSxTheme = {
                baseStyle: verbosedSx,
              };

              let sxHash = stableHash(sx);

              if (outputLibrary) {
                sxHash = outputLibrary + '-' + sxHash;
              }

              const { styledIds, verbosedStyleIds } = updateOrderUnResolvedMap(
                inlineSxTheme,
                sxHash,
                'inline',
                {},
                BUILD_TIME_GLUESTACK_STYLESHEET,
                platform
              );

              BUILD_TIME_GLUESTACK_STYLESHEET.resolve(
                styledIds,
                componentExtendedConfig,
                {},
                true,
                'inline'
              );

              const current_global_map =
                BUILD_TIME_GLUESTACK_STYLESHEET.getStyleMap();

              const orderedResolvedTheme = [];

              current_global_map?.forEach((styledResolved) => {
                if (styledIds.includes(styledResolved?.meta?.cssId)) {
                  orderedResolvedTheme.push(styledResolved);
                }
              });

              const styleIdsAst = generateObjectAst(verbosedStyleIds);

              const orderResolvedArrayExpression = [];

              orderedResolvedTheme.forEach((styledResolved) => {
                delete styledResolved.toBeInjected;
                if (targetPlatform === 'native') {
                  delete styledResolved.original;
                  delete styledResolved.value;
                  delete styledResolved.meta.cssRuleSet;
                  delete styledResolved.meta.weight;
                  delete styledResolved.type;
                  delete styledResolved.componentHash;
                  delete styledResolved.extendedConfig;
                }
                const orderedResolvedAst = generateObjectAst(styledResolved);
                orderResolvedArrayExpression.push(orderedResolvedAst);
              });

              jsxOpeningElementPath.node.attributes.push(
                t.jsxAttribute(
                  t.jsxIdentifier('verbosedStyleIds'),
                  t.jsxExpressionContainer(styleIdsAst)
                )
              );
              jsxOpeningElementPath.node.attributes.push(
                t.jsxAttribute(
                  t.jsxIdentifier('orderedResolved'),
                  t.jsxExpressionContainer(
                    t.arrayExpression(orderResolvedArrayExpression)
                  )
                )
              );
            }

            if (
              sxPropsWithIdentifier &&
              sxPropsWithIdentifier.properties &&
              sxPropsWithIdentifier.properties.length > 0
            ) {
              jsxOpeningElementPath.node.attributes.push(
                t.jsxAttribute(
                  t.jsxIdentifier('sx'),
                  t.jsxExpressionContainer(sxPropsWithIdentifier)
                )
              );
            }

            componentSXProp = undefined;
          }
        },
      },
    };
  } catch (err) {
    console.error('Something went wrong in babel: ', err);
  }
};
