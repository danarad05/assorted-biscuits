import vscode, { Position, Range, TextDocument as RawTextDocument, Uri } from "vscode";
import path from "path";
import { createActivate } from "biscuits-base";
import * as validator from "validate.js";

// @ts-ignore
import TreeSitter = require("../deps/tree-sitter");

const treeSitter = TreeSitter.init().then(() => {
  return new TreeSitter();
});

const languages = [
  // "agda", // does it even make sense here
  // "bash", // failed
  "csharp",
  "c",
  // "cpp", //failed
  // "css",
  "elm",
  // "embedded_template", //failed
  "go",
  // "html", //failed 
  "java",
  // "javascript", // ignored until we have typescript here
  "json",
  "lua",
  "kotlin",
  // "markdown", //failed
  "php",
  "python",
  // "ruby", //failed
  "rust",
  // "systemrdl", //failed
  "toml",
  // "vue", //failed
  "yaml",
];

const languageSettingsConstraints: any = {};

languages.forEach((language: string) => {
  languageSettingsConstraints[`${language}.annotationPrefix`] = {
    type: "string"
  };

  languageSettingsConstraints[`${language}.annotationColor`] = {
    type: "string"

  };

  languageSettingsConstraints[`${language}.annotationMinDistance`] = {
    type: "number",
    numericality: {
      greaterThanOrEqualTo: 0,
    }
  };

  languageSettingsConstraints[`${language}.annotationMaxLength`] = {
    type: "number",
    numericality: {
      greaterThanOrEqualTo: 0,
    }
  };
});

const languageNameConstraints = {
  key: {
    type: "string",
    inclusion: {
      within: languages,
      message: '^"%{value}" is not a supported language.'
    }
  }
};

const languageSettingsNamesConstraints: any = {};

languages.forEach(language => {
  languageSettingsNamesConstraints[language] = {
    key: {
      type: "string",
      inclusion: {
        within: [
          `annotationPrefix`,
          `annotationColor`,
          `annotationMinDistance`,
          `annotationMaxLength`,
        ],
        message: '^"%{value}" is not a supported property.'
      }
    }
  }
});

let hasShownInvalidSettingsWarning = false;
let previousSettingsString = "";

const TreeSitterLanguages: any = {};

const extras = treeSitter.then(async (innerTreeSitter: any) => {
  return Promise.all(
    languages.map((language) => {
      const grammarName = `tree-sitter-${language}`;
      const grammarWasm = `${grammarName}.wasm`;

      return TreeSitter.Language.load(grammarWasm).then(
        (treeSitterLanguage: any) => {
          TreeSitterLanguages[language] = treeSitterLanguage;
        }
      );
    })
  );
});

// Needs to be genericized
const CONFIG_PREFIX_KEY = "assorted-biscuits.annotationPrefix";
const CONFIG_COLOR_KEY = "assorted-biscuits.annotationColor";
const CONFIG_DISTANCE_KEY = "assorted-biscuits.annotationMinDistance";
const CONFIG_MAX_LENGTH = "assorted-biscuits.annotationMaxLength";
const CONFIG_LANGUAGE_SETTINGS = "assorted-biscuits.languageSettings";

let runningActivation: Promise<any>;

export const activate = createActivate(
  CONFIG_COLOR_KEY,
  CONFIG_DISTANCE_KEY,
  CONFIG_PREFIX_KEY,
  {
    async createDecorations(
      text: string,
      activeEditor: vscode.TextEditor,
      prefix: string,
      minDistance: number,
      context: vscode.ExtensionContext
    ) {
      try {

        let configPanel: vscode.WebviewPanel | undefined = undefined;

        const commands = await vscode.commands.getCommands(true);
        const commandName = 'assorted-biscuits.configLanguage';
        if(commands.indexOf(commandName) === -1) {


          context.subscriptions.push(
            vscode.commands.registerCommand(commandName, () => {
              configPanel = vscode.window.createWebviewPanel(
                'assortedBiscuitsSettings',
                'Assorted Biscuits Language Settings',
                vscode.ViewColumn.One,
                {
                  enableScripts: true,
                  localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, "bundled"))
                  ],
                  retainContextWhenHidden: true,
                  enableCommandUris: true
                }
              );

              configPanel.onDidDispose(() => {
                configPanel = undefined;
              });

              const appPathOnDisk = vscode.Uri.file(
                path.join(context.extensionPath, "bundled",  "configviewer.js")
              );

              const appUri = configPanel.webview.asWebviewUri(appPathOnDisk);

              if(configPanel) {
                configPanel.webview.html = _getWebviewContent(appUri);
                configPanel.webview.postMessage({
                  languages,
                  languageSettings: vscode.workspace.getConfiguration().get(CONFIG_LANGUAGE_SETTINGS) || {},
                  defaultSettings: {
                    'annotationPrefix': vscode.workspace.getConfiguration().get(CONFIG_PREFIX_KEY),
                    'annotationColor': vscode.workspace.getConfiguration().get(CONFIG_COLOR_KEY),
                    'annotationMinDistance': vscode.workspace.getConfiguration().get(CONFIG_DISTANCE_KEY),
                    'annotationMaxLength': vscode.workspace.getConfiguration().get(CONFIG_MAX_LENGTH),
                  }
                });

                configPanel.webview.onDidReceiveMessage((message) => {
                  const workspaceConfiguration = vscode.workspace.getConfiguration();
                  const currentLanguageSettings: any = workspaceConfiguration.get(CONFIG_LANGUAGE_SETTINGS);

                  const language: string = Object.keys(message)[0];

                  let newSettings: any = {};
                  if(currentLanguageSettings) {
                    newSettings = {
                      ...currentLanguageSettings,
                      [language]: {
                        ...currentLanguageSettings[language],
                        ...message[language]
                      }
                    };
                  } else {
                    newSettings = message;
                  }
                  workspaceConfiguration.update(CONFIG_LANGUAGE_SETTINGS, newSettings, true);

                });

              }
            })
          );

        }

        vscode.workspace.onDidChangeConfiguration((changeEvent) => {
          if(configPanel) {
            configPanel.webview.postMessage({
              languages,
              languageSettings: vscode.workspace.getConfiguration().get(CONFIG_LANGUAGE_SETTINGS) || {},
              defaultSettings: {
                'annotationPrefix': vscode.workspace.getConfiguration().get(CONFIG_PREFIX_KEY),
                'annotationColor': vscode.workspace.getConfiguration().get(CONFIG_COLOR_KEY),
                'annotationMinDistance': vscode.workspace.getConfiguration().get(CONFIG_DISTANCE_KEY),
                'annotationMaxLength': vscode.workspace.getConfiguration().get(CONFIG_MAX_LENGTH),
              }
            });
          }
        });

        const innerTreeSitter = await treeSitter;
        await extras;

        return _createDecorations(
          text,
          activeEditor,
          minDistance,
          prefix,
          innerTreeSitter
        );

      } catch (error) {
        console.log('error', error);
        return [];
      }
    },
  }
);

function _getWebviewContent(appUri: Uri) {

  return `
    <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src https:; script-src vscode-webview-resource: 'unsafe-inline' https:; style-src vscode-webview-resource: 'unsafe-inline';"
        >
        <title>Assorted Biscuits Language Settings</title>
        <script>
          window.acquireVsCodeApi = acquireVsCodeApi;
        </script>
      </head>
      <body>
        <h1>Assorted Biscuits Language Settings</h1>
        <div id="root"></div>
        <script src="${appUri}">
        </script>
      </body>
    </html>`;
}

function _createDecorations(
  text: string,
  activeEditor: vscode.TextEditor,
  minDistance: number,
  prefix: string,
  innerTreeSitter: any,
) {
  const editorLanguage = activeEditor.document.languageId;

  const currentSettings: any = vscode.workspace.getConfiguration().get(CONFIG_LANGUAGE_SETTINGS) || {};
  const settingsAreInvalid = validator.validate(currentSettings, languageSettingsConstraints);
  const currentSettingsString = JSON.stringify(currentSettings);

  const settingsNamesResults: any[] = [];

  const namesAreInvalidResults = Object.keys(currentSettings).map(
    (key: any) => {
      const keyIsInvalid = validator.validate({key}, languageNameConstraints);

      if(!keyIsInvalid) {
        Object.keys(currentSettings[key]).forEach(propKey => {
          settingsNamesResults.push(validator.validate({
            key: propKey
          }, languageSettingsNamesConstraints[key]));
        });
      }

      return keyIsInvalid;
    }
  );

  const namesAreInvalid = namesAreInvalidResults.some(result => !!result);

  const settingsNamesAreInvalid = settingsNamesResults.some(result => !!result);

  if(
    (settingsAreInvalid || namesAreInvalid || settingsNamesAreInvalid) &&
    !hasShownInvalidSettingsWarning &&
    currentSettingsString !== previousSettingsString
  ) {

      let message = `Assorted Biscuits 🍪 Invalid Settings: `;

      if(namesAreInvalid) {
        message += namesAreInvalidResults
          .filter(validation => !!validation)
          .map(validation => validation.key)
          .join(' • ');

        if(settingsAreInvalid || settingsNamesAreInvalid) {
          message += ' • ';
        }
      }

      if(settingsNamesAreInvalid) {
        message += settingsNamesResults
          .filter(validation => !!validation)
          .map(validation => validation.key)
          .join(' • ');

        if(settingsAreInvalid) {
          message += ' • ';
        }
      }

      if(settingsAreInvalid) {
        message += Object.values(settingsAreInvalid).join(' • ');
      }

      vscode.window.showWarningMessage(message);
    }

  previousSettingsString = currentSettingsString;

  if (!TreeSitterLanguages[editorLanguage]) {
    return [];
  }

  const languageSettings = currentSettings[editorLanguage];

  const macroStartRegex = /^\w*\#\[/gm;
  const scrubbedText = text.replace(macroStartRegex, '//');

  innerTreeSitter.setLanguage(TreeSitterLanguages[editorLanguage]);
  const parsedText = (innerTreeSitter as TreeSitter).parse(scrubbedText);

  let decorations: any[] = [];

  const biscuitsByFreshness: any = {};
  const biscuitsByStaleness: any = {};

  let nodes = parsedText.rootNode.children;
  let children: any[] = [];
  while (nodes.length > 0) {

    nodes.forEach((node: TreeSitter.SyntaxNode) => {
      if (node.children.length > 0) {
        children = [...children, ...node.children];
      }

      let startLine = node.startPosition.row;
      const endLine = node.endPosition.row;

      let contentText = "";

      contentText = activeEditor.document.lineAt(node.startPosition.row).text.trim();

      if(contentText.charAt(0) === '{') {
        contentText = node.text.replace(/(\r|\n|\r\n|\s)+/gm, " ");
      }

      if(
        node?.nextSibling?.type === ".") {
        contentText = '';
      }

      if(node?.nextSibling?.type === 'argument_list') {
        contentText = '';
      }

      let maxLength: number = (languageSettings && languageSettings["annotationMaxLength"]) ||
        vscode.workspace.getConfiguration().get(CONFIG_MAX_LENGTH) || 0;

      // if(settingsAreInvalid[]) {

      // }

      const newPrefix = (languageSettings && languageSettings["annotationPrefix"]) || prefix;

      if (maxLength && contentText.length > maxLength) {
        contentText = contentText.substr(0, maxLength) + "...";
      }

      const endOfLine = activeEditor.document.lineAt(endLine).range.end;

      contentText = contentText.trim();

      const userMinDistance = (languageSettings && languageSettings["annotationMinDistance"]) ||
      vscode.workspace.getConfiguration().get(CONFIG_DISTANCE_KEY) || 0;

      if (endLine && endLine - startLine >= userMinDistance && contentText && startLine != endLine) {

        if(node?.previousSibling?.type === "member_access_expression") {

          biscuitsByFreshness[endLine] = {
            range: new vscode.Range(
              activeEditor.document.positionAt(node.startIndex),
              endOfLine
            ),
            renderOptions: {
              after: {
                contentText: `${newPrefix} ${contentText}`,
              },
            },
          };
        } else if(!biscuitsByStaleness[endLine]) {

          biscuitsByStaleness[endLine] = true;

          decorations.push({
            range: new vscode.Range(
              activeEditor.document.positionAt(node.startIndex),
              endOfLine
            ),
            renderOptions: {
              after: {
                contentText: `${newPrefix} ${contentText}`,
              },
            },
          });
        }
      }
    });
    nodes = children;
    children = [];
  }

  decorations = [
    ...Object.values(biscuitsByFreshness),
    ...decorations
  ];

  return decorations;
}

const configScript = `

import { html } from 'sinuous';

const HelloMessage = ({ name }) => html\`
  <!-- Prints Hello World -->
  <div>Hello \${name}</div>
\`;

document.querySelector('#root').append(
  html\`<\${HelloMessage} name=World />\`
);

`