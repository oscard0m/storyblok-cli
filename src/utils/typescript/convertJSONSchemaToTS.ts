import { compile, type JSONSchema } from "json-schema-to-typescript";
import { autogeneratedPropertyTypes, generateType } from "./genericTypes";
import chalk from "chalk";
import fs from "fs";
import { parseBlokSchemaProperty } from "./parseBlokSchemaProperty";
import { getBlokTypeName } from "./getBlokTypeName";
import type { JSONSchemaToTSOptions } from "../../types";

// TOKENS
const storyDataTypeName = "ISbStoryData";

type ComponentGroupsAndNamesObject = {
  componentGroups: Map<string, Set<string>>;
  componentNames: Set<string>;
};

type GenerateTSTypedefsFromComponentsJSONSchemasOptions = {
  sourceFilePaths: string[];
  destinationFilePath: string;
  typeNamesPrefix?: string;
  typeNamesSuffix?: string;
  customFieldTypesParserPath?: string;
  JSONSchemaToTSCustomOptions: JSONSchemaToTSOptions;
};

type GenerateTSTypedefsFromComponentsJSONSchemasFn = (
  componentsJSONSchema: JSONSchema[],
  options: GenerateTSTypedefsFromComponentsJSONSchemasOptions
) => Promise<any>;

export const generateTSTypedefsFromComponentsJSONSchemas: GenerateTSTypedefsFromComponentsJSONSchemasFn = async (
  componentsJSONSchema,
  options
) => {
  console.log(`${chalk.green("✓")} Generating Typescript definitions ***`);

  const customFieldTypeParser =
    options.customFieldTypesParserPath &&
    (await import(options.customFieldTypesParserPath).then((data) => data.default));

  const typedefsFileStringsArray = [`import type { ${storyDataTypeName} } from "storyblok";`];

  // Generate a Map with the components that have a parent group (groupname - Set(componentName)) and a Set with all the component names
  const { componentGroups, componentNames } = componentsJSONSchema.reduce<ComponentGroupsAndNamesObject>(
    (acc, currentComponent) => {
      if (currentComponent.component_group_uuid)
        acc.componentGroups.set(
          currentComponent.component_group_uuid,
          acc.componentGroups.has(currentComponent.component_group_uuid)
            ? acc.componentGroups.get(currentComponent.component_group_uuid)!.add(currentComponent.name)
            : new Set([currentComponent.name])
        );

      acc.componentNames.add(currentComponent.name);
      return acc;
    },
    { componentGroups: new Map(), componentNames: new Set() }
  );

  async function generateTSFile() {
    for await (const component of componentsJSONSchema) {
      // By default all types will havea a required `_uid` and a required `component` properties
      const requiredFields = Object.entries<Record<string, any>>(component.schema).reduce(
        (acc, [key, value]) => {
          if (value.required) {
            return [...acc, key];
          }
          return acc;
        },
        ["component", "_uid"]
      );

      const title = getBlokTypeName(component.name, options);
      const obj: JSONSchema = {
        $id: `#/${component.name}`,
        title,
        type: "object",
        required: requiredFields,
      };

      obj.properties = await typeMapper(component.schema, title);
      obj.properties._uid = {
        type: "string",
      };
      obj.properties.component = {
        type: "string",
        enum: [component.name],
      };

      try {
        const ts = await compile(obj, component.name, options.JSONSchemaToTSCustomOptions);
        typedefsFileStringsArray.push(ts);
      } catch (e) {
        console.log("ERROR", e);
      }
    }
  }

  /**
   * Map a component schema to a ???
   * @param schema
   * @param title
   * @returns
   */
  const typeMapper = async (componentSchema: JSONSchema = {}, title: string) => {
    const parseObj = {};

    for await (const [schemaKey, schemaElement] of Object.entries(componentSchema)) {
      // Schema keys that start with `tab-` are only used for describing tabs in the Storyblok UI.
      // They should be ignored.
      if (schemaKey.startsWith("tab-")) {
        continue;
      }

      const obj: JSONSchema = {};
      const type = schemaElement.type;
      const element = parseBlokSchemaProperty(schemaElement, options);
      obj[schemaKey] = element;

      // Generate type for custom field
      if (type === "custom") {
        Object.assign(
          parseObj,
          typeof customFieldTypeParser === "function" ? customFieldTypeParser(schemaKey, schemaElement) : {}
        );

        continue;
      }

      // Generate type for field types provided by Storyblok

      // Include Storyblok field type type definition, if needed
      if (autogeneratedPropertyTypes.includes(type)) {
        const blokName = getBlokTypeName(type, options);
        const ts = await generateType(type, blokName, options.JSONSchemaToTSCustomOptions);
        obj[schemaKey].tsType = blokName;

        if (ts) {
          typedefsFileStringsArray.push(ts);
        }
      }

      if (type === "multilink") {
        const excludedLinktypes = [];
        const baseType = getBlokTypeName(type, options);

        // TODO: both email_link_type and asset_link_type are booleans that could also be undefined.
        // Do we want to exclude link types also in those cases?
        if (!schemaElement.email_link_type) {
          excludedLinktypes.push('{ linktype?: "email" }');
        }
        if (!schemaElement.asset_link_type) {
          excludedLinktypes.push('{ linktype?: "asset" }');
        }

        obj[schemaKey].tsType =
          excludedLinktypes.length > 0 ? `Exclude<${baseType}, ${excludedLinktypes.join(" | ")}>` : baseType;
      }

      if (type === "bloks") {
        if (schemaElement.restrict_components) {
          // Bloks restricted by groups
          if (schemaElement.restrict_type === "groups") {
            if (
              Array.isArray(schemaElement.component_group_whitelist) &&
              schemaElement.component_group_whitelist.length > 0
            ) {
              const currentGroupElements = schemaElement.component_group_whitelist.reduce(
                (bloks: string[], groupUUID: string) => {
                  const bloksInGroup = componentGroups.get(groupUUID);
                  return bloksInGroup
                    ? [...bloks, ...Array.from(bloksInGroup).map((blokName) => getBlokTypeName(blokName, options))]
                    : bloks;
                },
                []
              );

              obj[schemaKey].tsType =
                currentGroupElements.length > 0 ? `(${currentGroupElements.join(" | ")})[]` : `never[]`;
            }
          } else {
            // Bloks restricted by 1-by-1 list
            if (Array.isArray(schemaElement.component_whitelist) && schemaElement.component_whitelist.length > 0) {
              obj[schemaKey].tsType = `(${schemaElement.component_whitelist
                .map((name: string) => getBlokTypeName(name, options))
                .join(" | ")})[]`;
            }
          }
        } else {
          // All bloks can be slotted in this property (AKA no restrictions)
          obj[schemaKey].tsType = `(${Array.from(componentNames)
            .map((blokName) => getBlokTypeName(blokName, options))
            .join(" | ")})[]`;
        }
      }

      Object.assign(parseObj, obj);
    }

    return parseObj;
  };

  await generateTSFile();

  if (options.destinationFilePath) {
    fs.writeFileSync(options.destinationFilePath, typedefsFileStringsArray.join("\n"));
  }

  return typedefsFileStringsArray;
};
