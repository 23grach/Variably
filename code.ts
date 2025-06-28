/**
 * Variables Sheet - Figma plugin for creating variable tables
 * 
 * This plugin automatically generates beautiful tables from Figma variable collections.
 * Supports all variable types, multiple modes/themes, grouping by prefixes
 * and intelligent value formatting.
 */

figma.showUI(__html__, { width: 400, height: 700 });

/** Automatically load collections on plugin startup */
loadCollections();

/** Load saved user settings on startup */
loadUserSettings();

/**
 * Application constants to avoid magic numbers
 * Contains settings for sizes, animations and validation
 */
const APP_CONSTANTS = {
  /** Text sizes */
  TEXT_SIZE: {
    HEADER: 16,
    BODY: 14,
    SMALL: 12
  },
  /** Animation settings */
  ANIMATION: {
    DURATION: 200
  },
  /** Validation parameters */
  VALIDATION: {
    MIN_WIDTH: 100,
    MAX_VARIABLES: 1000
  }
} as const;

/**
 * Strictly typed interface for table configuration
 */
interface StrictTableConfig {
  readonly spacing: {
    readonly section: number;
    readonly group: number;
    readonly cell: number;
    readonly item: number;
  };
  readonly sizes: {
    readonly cellHeight: number;
    readonly colorCircle: number;
    readonly columnWidth: {
      readonly designToken: number;
      readonly devToken: number;
      readonly value: number;
    };
  };
  readonly radius: {
    readonly group: number;
    readonly header: number;
  };
}

/**
 * Validates input data for expected type compliance
 * @param value Value to check
 * @param type Expected data type
 * @returns Validation result
 */
function validateInput(value: unknown, type: 'string' | 'number' | 'boolean'): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string' && value.length > 0;
    case 'number':
      return typeof value === 'number' && !isNaN(value) && isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

/**
 * Checks validity of RGB(A) color object
 * Validates structure and value ranges for color components
 * @param color Object to check for color format compliance
 * @returns Validation result with type guard
 */
function _isValidColor(color: unknown): color is { r: number; g: number; b: number; a?: number } {
  if (typeof color !== 'object' || color === null) return false;
  
  const c = color as Record<string, unknown>;
  
  /** Check presence and validity of required RGB components */
  if (!validateInput(c.r, 'number') || !validateInput(c.g, 'number') || !validateInput(c.b, 'number')) {
    return false;
  }
  
  const r = c.r as number;
  const g = c.g as number;
  const b = c.b as number;
  
  /** Check RGB value ranges (0-1) */
  if (r < 0 || r > 1 || g < 0 || g > 1 || b < 0 || b > 1) {
    return false;
  }
  
  /** Check alpha channel (optional) */
  if (c.a !== undefined) {
    if (!validateInput(c.a, 'number')) {
      return false;
    }
    const a = c.a as number;
    if (a < 0 || a > 1) {
      return false;
    }
  }
  
  return true;
}

/**
 * Table size and spacing configuration
 */
const TABLE_CONFIG: StrictTableConfig = {
  spacing: {
    section: 24,
    group: 16,
    cell: 0,
    item: 12
  },
  sizes: {
    cellHeight: 48,
    colorCircle: 20,
    columnWidth: {
      designToken: 440,
      devToken: 480,
      value: 480
    }
  },
  radius: {
    group: 16,
    header: 16
  }
} as const;

/**
 * Color scheme for dark theme table
 */
const TABLE_COLORS = {
  group: {
    stroke: { r: 163/255, g: 171/255, b: 187/255 },
    background: { r: 163/255, g: 171/255, b: 187/255 }
  },
  header: {
    background: { r: 29/255, g: 30/255, b: 32/255 }
  },
  dataRow: {
    background: { r: 20/255, g: 20/255, b: 21/255 }
  },
  text: {
    primary: { r: 154/255, g: 161/255, b: 177/255 }
  },
  colorCircle: {
    stroke: { r: 179/255, g: 182/255, b: 189/255 }
  }
} as const;

/**
 * Color scheme for light theme table
 */
const TABLE_COLORS_LIGHT = {
  group: {
    stroke: { r: 222/255, g: 226/255, b: 230/255 },
    background: { r: 222/255, g: 226/255, b: 230/255 }
  },
  header: {
    background: { r: 248/255, g: 249/255, b: 250/255 }
  },
  dataRow: {
    background: { r: 255/255, g: 255/255, b: 255/255 }
  },
  text: {
    primary: { r: 73/255, g: 80/255, b: 87/255 }
  },
  colorCircle: {
    stroke: { r: 173/255, g: 181/255, b: 189/255 }
  }
} as const;

/**
 * Returns color scheme based on selected theme
 * @param theme Table theme ('light' or 'dark')
 * @returns Color scheme object
 */
function getTableColors(theme: string) {
  return theme === 'light' ? TABLE_COLORS_LIGHT : TABLE_COLORS;
}

/**
 * Font configuration for table
 */
const FONT_CONFIG = {
  primary: { family: "JetBrains Mono", style: "Medium" },
  secondary: { family: "Inter", style: "Medium" },
  fallback: { family: "Roboto", style: "Regular" },
  header: { family: "Roboto", style: "Medium" }
} as const;

/**
 * Variable data structure with information about values, types and aliases
 */
interface VariableData {
  name: string;
  devToken: string;
  variableType: VariableResolvedDataType;
  values: { [modeId: string]: string | number | boolean | { r: number; g: number; b: number; a?: number } };
  variable: Variable;
  colorValues?: { [modeId: string]: { r: number; g: number; b: number; a?: number } | null };
  aliasVariables?: { [modeId: string]: Variable | null };
}

/**
 * Information about collection mode/theme
 */
interface ModeInfo {
  modeId: string;
  name: string;
}

/**
 * Information about variable group (by prefix)
 */
interface GroupInfo {
  prefix: string;
  count: number;
  /** Flag for individual variables */
  isIndividual?: boolean;
  /** Full variable name for individual elements */
  variableName?: string;
}

/**
 * Style configuration for variable groups
 */
interface GroupStyleConfig {
  cornerRadius: number;
  strokeColor: { r: number; g: number; b: number };
  strokeOpacity: number;
  strokeWeight: number;
  fillColor: { r: number; g: number; b: number };
  fillOpacity: number;
}

/**
 * Cache for loaded fonts
 */
const fontCache = new Map<string, FontName>();

/**
 * Cache for creating fills
 */
const fillCache = new Map<string, SolidPaint>();

/**
 * Creates SOLID type fill with caching for performance optimization
 * Used for applying colors to Figma elements
 * @param color RGB color in {r, g, b} format where values are from 0 to 1
 * @param opacity Transparency from 0 to 1 (default 1.0)
 * @returns SolidPaint object for applying to elements
 */
function createSolidFill(color: { r: number; g: number; b: number }, opacity?: number): SolidPaint {
  const key = `${color.r}-${color.g}-${color.b}-${opacity ?? 1}`;
  
  if (fillCache.has(key)) {
    return fillCache.get(key)!;
  }
  
  const fill: SolidPaint = {
    type: 'SOLID',
    color,
    ...(opacity !== undefined && { opacity })
  };
  
  fillCache.set(key, fill);
  return fill;
}

/**
 * Loads font with fallback system and caching
 * Attempts to load fonts in priority order, returns first available
 * @param type Font type to load
 * @returns Promise with FontName object of loaded font
 */
async function loadFontWithFallback(type: 'primary' | 'secondary' | 'header' | 'fallback' = 'primary'): Promise<FontName> {
  const cacheKey = type;
  
  if (fontCache.has(cacheKey)) {
    return fontCache.get(cacheKey)!;
  }
  
  const fontOrder = type === 'header' ? 
    [FONT_CONFIG.header, FONT_CONFIG.fallback] :
    type === 'secondary' ?
    [FONT_CONFIG.secondary, FONT_CONFIG.fallback] :
    [FONT_CONFIG.primary, FONT_CONFIG.secondary, FONT_CONFIG.fallback];

  for (const font of fontOrder) {
    try {
      await figma.loadFontAsync(font);
      fontCache.set(cacheKey, font);
      return font;
    } catch (error) {
      /** Continue to next font */
      continue;
    }
  }
  
  /** Return last fallback if nothing loaded */
  fontCache.set(cacheKey, FONT_CONFIG.fallback);
  return FONT_CONFIG.fallback;
}

/**
 * Creates style configuration for variable groups
 * Defines appearance of group containers in the table
 * @param theme Table theme ('light' or 'dark')
 * @returns Configuration object with border, fill and rounding settings
 */
function createGroupStyles(theme: string = 'dark'): GroupStyleConfig {
  const colors = getTableColors(theme);
  return {
    cornerRadius: TABLE_CONFIG.radius.group,
    strokeColor: colors.group.stroke,
    strokeOpacity: 0.5,
    strokeWeight: 1,
    fillColor: colors.group.background,
    fillOpacity: 0.03
  };
}

/**
 * Applies visual styles to variable group frame
 * Configures borders, fill and corner rounding
 * @param frame Frame to style
 * @param styles Style configuration to apply
 */
function applyGroupStyles(frame: FrameNode, styles: GroupStyleConfig): void {
  frame.cornerRadius = styles.cornerRadius;
  frame.strokes = [{
    type: 'SOLID',
    color: styles.strokeColor,
    opacity: styles.strokeOpacity
  }];
  frame.strokeWeight = styles.strokeWeight;
  frame.fills = [{
    type: 'SOLID',
    color: styles.fillColor,
    opacity: styles.fillOpacity
  }];
}

/**
 * Memoized base frame creation
 */
const createBaseCellMemoized = (() => {
  const cache = new Map<string, Partial<FrameNode>>();
  
  return function(name: string, width: number, layoutMode: 'HORIZONTAL' | 'VERTICAL' = 'VERTICAL'): FrameNode {
    const cacheKey = `${width}-${layoutMode}`;
    let template = cache.get(cacheKey);
    
    if (!template) {
      template = {
        layoutMode,
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'AUTO',
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 12,
        paddingBottom: 12,
        itemSpacing: layoutMode === 'HORIZONTAL' ? TABLE_CONFIG.spacing.item : 0,
        fills: []
      };
      cache.set(cacheKey, template);
    }
    
    const cell = figma.createFrame();
    Object.assign(cell, template);
    cell.name = name;
    cell.resize(width, TABLE_CONFIG.sizes.cellHeight);
    
    return cell;
  };
})();

/**
 * Creates multiple text elements in batch mode for optimization
 * Preloads all necessary fonts before creating elements
 * @param texts Array of objects with text and font type
 * @param tableTheme Table theme for determining colors
 * @returns Promise with array of created text elements
 */
async function createTextNodesBatch(texts: Array<{ text: string; fontType?: 'primary' | 'secondary' | 'header' }>, tableTheme: string = 'dark'): Promise<TextNode[]> {
  /** Preload all necessary fonts */
  const fontTypes = [...new Set(texts.map(t => t.fontType || 'primary'))];
  await Promise.all(fontTypes.map(type => loadFontWithFallback(type)));
  
  const colors = getTableColors(tableTheme);
  
  return Promise.all(texts.map(async ({ text, fontType = 'primary' }) => {
    const textNode = figma.createText();
    textNode.fontName = await loadFontWithFallback(fontType);
    textNode.characters = text;
    textNode.fontSize = APP_CONSTANTS.TEXT_SIZE.BODY;
    textNode.fills = [createSolidFill(colors.text.primary)];
    return textNode;
  }));
}

/**
 * Central message handler for user interface
 * Routes UI commands to appropriate plugin functions
 * Provides error handling and operation logging
 */
  figma.ui.onmessage = async (msg: { type: string; collectionId?: string; collectionName?: string; modes?: ModeInfo[]; groups?: GroupInfo[]; tableTheme?: string; showDevToken?: boolean; showSwatches?: boolean; settings?: UserSettings }) => {
    /** Debug logging of messages */
    console.log('Message received:', msg.type, msg);
  try {
    switch (msg.type) {
      case 'load-collections':
        await loadCollections();
        break;
      
      case 'load-groups':
        if (msg.collectionId) {
          await loadGroups(msg.collectionId);
        }
        break;
      
      case 'create-table': {
        const createTableMsg = msg as typeof msg & { showDevToken?: boolean; showSwatches?: boolean };
        console.log('Creating table with params:', {
          collectionId: createTableMsg.collectionId,
          collectionName: createTableMsg.collectionName,
          modes: createTableMsg.modes,
          groups: createTableMsg.groups,
          tableTheme: createTableMsg.tableTheme,
          showDevToken: createTableMsg.showDevToken,
          showSwatches: createTableMsg.showSwatches
        });
        if (createTableMsg.collectionId && createTableMsg.collectionName && createTableMsg.modes && createTableMsg.groups) {
          await createVariablesTable(createTableMsg.collectionId, createTableMsg.collectionName, createTableMsg.modes, createTableMsg.groups, createTableMsg.tableTheme || 'dark', createTableMsg.showDevToken !== false, createTableMsg.showSwatches !== false);
        } else {
          console.error('Missing required parameters for table creation');
          figma.ui.postMessage({
            type: 'error',
            message: 'Missing required parameters for table creation'
          });
        }
        break;
      }
      
      case 'save-settings':
        if (msg.settings) {
          await saveUserSettings(msg.settings);
        }
        break;
    }
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
};

/**
 * Loads all local variable collections and sends data to UI
 * Counts variables in each collection to display statistics
 * Handles errors and sends error notifications to interface
 */
async function loadCollections(): Promise<void> {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const allVariables = await figma.variables.getLocalVariablesAsync();
    
    /** Debug logging of found collections count */
    console.log('Found collections:', collections.length);
    
    const collectionsData = collections.map(collection => {
      const variableCount = allVariables.filter(variable => 
        variable.variableCollectionId === collection.id
      ).length;
      
      return {
        id: collection.id,
        name: collection.name,
        modes: collection.modes,
        variableCount: variableCount
      };
    });

    /** Debug logging of collections data */
    console.log('Sending collections data:', collectionsData);

    figma.ui.postMessage({
      type: 'collections-loaded',
      collections: collectionsData
    });
  } catch (error) {
    /** Debug logging of collection loading errors */
    console.error('Error loading collections:', error);
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to load collections: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
}

/**
 * Analyzes and groups variables of selected collection by prefixes
 * Extracts prefixes from variable names (part before first slash) and counts quantity
 * Sorts groups alphabetically for convenient navigation
 * @param collectionId Collection identifier for analysis
 */
async function loadGroups(collectionId: string): Promise<void> {
  try {
    const allVariables = await figma.variables.getLocalVariablesAsync();
    const collectionVariables = allVariables.filter(variable => 
      variable.variableCollectionId === collectionId
    );
    
    const totalVariables = collectionVariables.length;
    
    /** Group variables by prefixes and collect individual variables */
    const groupsMap = new Map<string, number>();
    const individualVariables: string[] = [];
    
    collectionVariables.forEach(variable => {
      const nameParts = variable.name.split('/');
      /** If variable has a group (contains slash) */
      if (nameParts.length > 1 && nameParts[0].trim()) {
        const prefix = nameParts[0];
        groupsMap.set(prefix, (groupsMap.get(prefix) || 0) + 1);
      } else {
        /** Variable without group - add as individual */
        individualVariables.push(variable.name);
      }
    });
    
    /** Create list of groups */
    let groups: GroupInfo[] = Array.from(groupsMap.entries())
      .map(([prefix, count]) => ({ prefix, count }))
      .sort((a, b) => a.prefix.localeCompare(b.prefix, 'en', { sensitivity: 'base' }));
    
    /** Add individual variables to list */
    const individualGroups: GroupInfo[] = individualVariables
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
      .map(variableName => ({
        prefix: variableName,
        count: 1,
        isIndividual: true,
        variableName: variableName
      }));
    
    /** Combine groups and individual variables */
    groups = [...groups, ...individualGroups];
    
    figma.ui.postMessage({
      type: 'groups-loaded',
      groups: groups,
      totalVariables: totalVariables
    });
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to load groups: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
}

/**
 * Filters collection variables by user-selected groups
 * Returns only variables belonging to specified prefixes
 * @param collectionId Variable collection identifier
 * @param groups Array of selected groups for filtering
 * @returns Promise with filtered array of variables
 */
async function getFilteredVariables(collectionId: string, groups: GroupInfo[]): Promise<Variable[]> {
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) {
    throw new Error('Collection not found');
  }

  /** Get all variables from collection */
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(variable => 
    variable.variableCollectionId === collectionId
  );

  /** Filter variables by selected groups */
  const filteredVariables = collectionVariables.filter(variable => {
    const nameParts = variable.name.split('/');
    
    /** Check each selected group */
    return groups.some(group => {
      if (group.isIndividual) {
        /** For individual variables compare full name */
        return variable.name === group.variableName;
      } else {
        /** For groups compare prefix */
        if (nameParts.length > 1 && nameParts[0].trim()) {
          return nameParts[0] === group.prefix;
        }
        return false;
      }
    });
  });

  if (filteredVariables.length === 0) {
    throw new Error('No variables found in selected groups');
  }

  return filteredVariables;
}

/**
 * Processes Figma variable and resolves its values for all modes/themes
 * Extracts values, processes aliases and prepares data for display
 * For color variables additionally resolves actual colors and aliases
 * @param variable Figma variable to process
 * @param modes Array of collection modes/themes
 * @returns Promise with fully processed variable data
 */
async function processVariableData(variable: Variable, modes: ModeInfo[]): Promise<VariableData> {
  const values: { [modeId: string]: string | number | boolean | { r: number; g: number; b: number; a?: number } } = {};
  const colorValues: { [modeId: string]: { r: number; g: number; b: number; a?: number } | null } = {};
  const aliasVariables: { [modeId: string]: Variable | null } = {};
  
  /** Get values for each theme */
  for (const mode of modes) {
    const rawValue = variable.valuesByMode[mode.modeId];
    
    /** Resolve value for display */
    values[mode.modeId] = await resolveVariableValue(variable, mode.modeId, rawValue);
    
    /** For color variables also get actual color */
    if (variable.resolvedType === 'COLOR') {
      const resolvedColor = await resolveColorValue(variable, mode.modeId, rawValue);
      colorValues[mode.modeId] = resolvedColor;
      
      /** Check if this is an alias and save reference to alias variable */
      if (typeof rawValue === 'object' && rawValue !== null && 'type' in rawValue && rawValue.type === 'VARIABLE_ALIAS' && 'id' in rawValue) {
        try {
          const referencedVariable = await figma.variables.getVariableByIdAsync(rawValue.id as string);
          aliasVariables[mode.modeId] = referencedVariable || null;
        } catch (error) {
          aliasVariables[mode.modeId] = null;
        }
      } else {
        /** Not an alias - use the variable itself */
        aliasVariables[mode.modeId] = variable;
      }
    }
  }

  return {
    name: variable.name,
    devToken: generateDevToken(variable.name),
    variableType: variable.resolvedType,
    values,
    variable,
    colorValues: variable.resolvedType === 'COLOR' ? colorValues : undefined,
    aliasVariables: variable.resolvedType === 'COLOR' ? aliasVariables : undefined
  };
}

/**
 * Sorts variables hierarchically: first by prefixes, then alphabetically within groups
 * Ensures logical grouping and ordering of variables in the table
 * @param variablesData Array of variable data for sorting
 * @returns Sorted array of variables
 */
function sortVariablesByPrefixAndName(variablesData: VariableData[]): VariableData[] {
  return variablesData.sort((a, b) => {
    const getPrefixAndPath = (name: string) => {
      const parts = name.split('/');
      const prefix = parts[0] || '';
      return { prefix, fullPath: name };
    };
    
    const aData = getPrefixAndPath(a.name);
    const bData = getPrefixAndPath(b.name);
    
    /** First sort by prefixes */
    const prefixComparison = aData.prefix.localeCompare(bData.prefix, 'en', { sensitivity: 'base' });
    if (prefixComparison !== 0) {
      return prefixComparison;
    }
    
    /** If prefixes are the same, sort by full path */
    return aData.fullPath.localeCompare(bData.fullPath, 'en', { sensitivity: 'base' });
  });
}

/**
 * Main function for creating variable table from selected collection
 * Coordinates the entire process: filtering, data processing, sorting and UI creation
 * Handles errors and shows notifications to user
 * @param collectionId Variable collection identifier
 * @param collectionName Collection name for display
 * @param modes Array of collection modes/themes
 * @param groups User-selected variable groups
 */
async function createVariablesTable(collectionId: string, collectionName: string, modes: ModeInfo[], groups: GroupInfo[], tableTheme: string, showDevToken: boolean = true, showSwatches: boolean = true): Promise<void> {
  try {
    /** 1. Get and filter variables */
    const filteredVariables = await getFilteredVariables(collectionId, groups);

    /** 2. Prepare variable data */
    const variablesData: VariableData[] = await Promise.all(
      filteredVariables.map(variable => processVariableData(variable, modes))
    );

    /** 3. Sort variables */
    const sortedVariablesData = sortVariablesByPrefixAndName(variablesData);
    
    /** 4. Create table */
    await createTableFrame(sortedVariablesData, modes, tableTheme, showDevToken, showSwatches);
    
    /** Show success notification and close plugin */
    figma.notify('✅ Variables table created successfully!', { timeout: 3000 });
    figma.closePlugin();
    
  } catch (error) {
    /** Show error */
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    figma.notify(`❌ Error: ${errorMessage}`, { error: true, timeout: 5000 });
    
    /** Send message to UI to show error */
    figma.ui.postMessage({
      type: 'error',
      message: errorMessage
    });
  }
}

/**
 * Formats variable name for table display
 * Replaces slashes with dashes for improved readability
 * @param variableName Original variable name from Figma
 * @returns Formatted name for display
 */
function formatVariableName(variableName: string): string {
  return variableName.replace(/\//g, '-');
}

/**
 * Generates CSS custom property from Figma variable name
 * Converts name to valid CSS variable format with var() prefix
 * Cleans invalid characters and converts to lowercase
 * @param variableName Original variable name from Figma
 * @returns CSS custom property in var(--variable-name) format
 */
function generateDevToken(variableName: string): string {
  const cleanName = variableName
    .replace(/\//g, '-')        /** Replace slashes with dashes */
    .replace(/\s+/g, '-')       /** Replace spaces with dashes */
    .replace(/[^a-zA-Z0-9\-_]/g, ''); /** Remove all other special characters, keeping uppercase letters */
  
  return `var(--${cleanName})`;
}

/**
 * Converts RGB(A) color to readable HEX format for display
 * Converts 0-1 values to 0-255, adds transparency percentage when needed
 * @param color Color object with r, g, b components and optional a
 * @returns HEX format string with transparency percentages when needed
 */
function formatColor(color: { r: number; g: number; b: number; a?: number }): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  
  /** Form hex code */
  const hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  
  /** If there's alpha channel and it's not equal to 1 (100%) */
  if (color.a !== undefined && color.a !== 1) {
    const percentage = Math.round(color.a * 100);
    return `${hexColor} ${percentage}%`;
  }
  
  return hexColor;
}

/**
 * Formats numeric values for optimal table display
 * Removes unnecessary zeros, rounds to reasonable precision
 * @param num Number to format
 * @returns String representation of number without unnecessary decimal places
 */
function formatNumber(num: number): string {
  /** If it's an integer, show without decimal places */
  if (Number.isInteger(num)) {
    return num.toString();
  }
  
  /** Round to 3 decimal places for precision */
  const rounded = Math.round(num * 1000) / 1000;
  
  /** Convert to string and remove trailing zeros */
  let result = rounded.toString();
  
  /** If number has decimal part, remove trailing zeros */
  if (result.includes('.')) {
    result = result.replace(/\.?0+$/, '');
  }
  
  return result;
}

/**
 * Resolves variable value for table display
 * Handles variable aliases, color objects and primitive types
 * Recursively resolves references to other variables
 * @param variable Figma variable to process
 * @param modeId Mode/theme identifier
 * @param value Raw variable value from Figma API
 * @returns Promise with resolved value for display
 */
async function resolveVariableValue(variable: Variable, modeId: string, value: unknown): Promise<string | number | boolean | { r: number; g: number; b: number; a?: number }> {
  if (value === undefined || value === null) {
    return '';
  }

  /** Check for VARIABLE_ALIAS */
  if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS' && 'id' in value) {
    try {
      const referencedVariable = await figma.variables.getVariableByIdAsync(value.id as string);
      if (referencedVariable) {
        /** For alias variables return formatted reference variable name */
        return formatVariableName(referencedVariable.name);
      } else {
        return 'Unknown variable';
      }
    } catch (error) {
      return 'Error resolving alias';
    }
  }

  /** For direct values */
  if (typeof value === 'object' && value !== null && 'r' in value) {
    /** This is a color value - return as is for further processing */
    return value as { r: number; g: number; b: number; a?: number };
  }

  /** For other types return as is */
  return value as string | number | boolean;
}

/**
 * Recursively resolves color value of variable, including aliases
 * Specialized function for working with color variables and their references
 * Provides fallback to available modes when value is missing in current mode
 * @param variable Figma variable to process
 * @param modeId Mode/theme identifier
 * @param value Raw variable value from Figma API
 * @returns Promise with resolved color value or null on error
 */
async function resolveColorValue(variable: Variable, modeId: string, value: unknown): Promise<{ r: number; g: number; b: number; a?: number } | null> {
  /** Check for undefined and null */
  if (value === undefined || value === null) {
    return null;
  }

  /** If this is an alias (reference to another variable) */
  if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS' && 'id' in value) {
    try {
      const referencedVariable = await figma.variables.getVariableByIdAsync(value.id as string);
      
      if (referencedVariable && referencedVariable.resolvedType === 'COLOR') {
        /** First try the same mode */
        let refValue = referencedVariable.valuesByMode[modeId];
        
        /** If there's no value in the same mode, try first available mode */
        if (refValue === undefined) {
          const availableModes = Object.keys(referencedVariable.valuesByMode);
          if (availableModes.length > 0) {
            const firstMode = availableModes[0];
            refValue = referencedVariable.valuesByMode[firstMode];
          }
        }
        
        if (refValue !== undefined) {
          const recursiveResult = await resolveColorValue(referencedVariable, modeId, refValue);
          return recursiveResult;
        } else {
          return null;
        }
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  /** If this is a string that might be a variable name (for cases when resolveVariableValue already resolved alias) */
  if (typeof value === 'string' && value.includes('/')) {
    try {
      /** Get all variables and search by name */
      const allVariables = await figma.variables.getLocalVariablesAsync();
      const foundVariable = allVariables.find(v => v.name === value && v.resolvedType === 'COLOR');
      
      if (foundVariable) {
        const foundValue = foundVariable.valuesByMode[modeId];
        if (foundValue !== undefined) {
          return await resolveColorValue(foundVariable, modeId, foundValue);
        } else {
          /** Try first available mode */
          const availableModes = Object.keys(foundVariable.valuesByMode);
          if (availableModes.length > 0) {
            const firstMode = availableModes[0];
            const fallbackValue = foundVariable.valuesByMode[firstMode];
            return await resolveColorValue(foundVariable, firstMode, fallbackValue);
          }
        }
      }
    } catch (error) {
      return null;
    }
  }

  /** For direct color values */
  if (typeof value === 'object' && value !== null && 'r' in value && 'g' in value && 'b' in value) {
    const colorResult = value as { r: number; g: number; b: number; a?: number };
    return colorResult;
  }
  
  return null;
}

/**
 * Groups variables by prefixes (first part of name before slash)
 * @param variablesData Array of variable data
 * @returns Map with variables grouped by prefixes
 */
function groupVariablesByPrefix(variablesData: VariableData[]): Map<string, VariableData[]> {
  const groupedVariables = new Map<string, VariableData[]>();
  
  variablesData.forEach(variable => {
    const prefix = variable.name.split('/')[0] || 'other';
    if (!groupedVariables.has(prefix)) {
      groupedVariables.set(prefix, []);
    }
    groupedVariables.get(prefix)!.push(variable);
  });
  
  return groupedVariables;
}

/**
 * Creates main table with Design Token and Dev Token columns
 * @param groupedVariables Variables grouped by prefixes
 * @param tableTheme Table theme ('light' or 'dark')
 * @returns FrameNode of main table
 */
async function createMainVariablesTable(groupedVariables: Map<string, VariableData[]>, tableTheme: string, showDevToken: boolean = true, showSwatches: boolean = true): Promise<FrameNode> {
  const mainTableFrame = figma.createFrame();
  mainTableFrame.name = 'Main Table';
  mainTableFrame.layoutMode = 'VERTICAL';
  mainTableFrame.primaryAxisSizingMode = 'AUTO';
  mainTableFrame.counterAxisSizingMode = 'AUTO';
  mainTableFrame.itemSpacing = TABLE_CONFIG.spacing.group;
  mainTableFrame.fills = [];
  mainTableFrame.strokes = [];
  
  /** Create groups with headers */
  for (const [prefix, variables] of groupedVariables) {
    const groupFrame = await createVariableGroup(prefix, variables, 'main', undefined, tableTheme, showDevToken, showSwatches);
    mainTableFrame.appendChild(groupFrame);
  }
  
  return mainTableFrame;
}

/**
 * Создает таблицы для каждой темы с колонкой значений
 * @param groupedVariables - Группированные переменные по префиксам
 * @param modes - Массив режимов/тем
 * @param tableTheme - Тема таблицы ('light' или 'dark')
 * @returns Массив FrameNode для каждой темы
 */
async function createThemeVariablesTables(groupedVariables: Map<string, VariableData[]>, modes: ModeInfo[], tableTheme: string, showSwatches: boolean = true): Promise<FrameNode[]> {
  const themeFrames: FrameNode[] = [];
  
  for (const mode of modes) {
    const themeFrame = figma.createFrame();
    themeFrame.name = `Theme: ${mode.name}`;
    themeFrame.layoutMode = 'VERTICAL';
    themeFrame.primaryAxisSizingMode = 'AUTO';
    themeFrame.counterAxisSizingMode = 'AUTO';
    themeFrame.itemSpacing = TABLE_CONFIG.spacing.group;
    themeFrame.fills = [];
    themeFrame.strokes = [];
    
    /** Create groups for each prefix within the theme */
    for (const [prefix, variables] of groupedVariables) {
      const themeGroupFrame = await createVariableGroup(prefix, variables, 'theme', mode, tableTheme, true, showSwatches);
      themeFrame.appendChild(themeGroupFrame);
    }
    
    themeFrames.push(themeFrame);
  }
  
  return themeFrames;
}

/**
 * Creates variable group (for main table or theme)
 * @param prefix Group prefix
 * @param variables Group variables
 * @param type Table type: 'main' or 'theme'
 * @param mode Mode information (only for 'theme' type)
 * @param tableTheme Table theme ('light' or 'dark')
 * @returns FrameNode of variable group
 */
async function createVariableGroup(prefix: string, variables: VariableData[], type: 'main' | 'theme', mode?: ModeInfo, tableTheme: string = 'dark', showDevToken: boolean = true, showSwatches: boolean = true): Promise<FrameNode> {
  /** Create frame for group */
  const groupFrame = figma.createFrame();
  groupFrame.name = type === 'main' ? `Group: ${prefix}` : `${mode!.name} - ${prefix}`;
  groupFrame.layoutMode = 'VERTICAL';
  groupFrame.primaryAxisSizingMode = 'AUTO';
  groupFrame.counterAxisSizingMode = 'AUTO';
  groupFrame.itemSpacing = TABLE_CONFIG.spacing.cell;
  groupFrame.paddingTop = 0;
  groupFrame.paddingBottom = 0;
  groupFrame.paddingLeft = 0;
  groupFrame.paddingRight = 0;
  
  /** Styles for group */
  applyGroupStyles(groupFrame, createGroupStyles(tableTheme));
  
  /** Create header */
  const headerRow = type === 'main' 
    ? await createMainHeaderRow(tableTheme, showDevToken) 
    : await createThemeHeaderRow(mode!.name, tableTheme);
  groupFrame.appendChild(headerRow);
  
  /** Create data rows */
  for (let i = 0; i < variables.length; i++) {
    try {
      const dataRow = type === 'main' 
        ? await createMainDataRow(variables[i], i === variables.length - 1, tableTheme, showDevToken)
        : await createThemeDataRow(variables[i], mode!, i === variables.length - 1, tableTheme, showSwatches);
      groupFrame.appendChild(dataRow);
    } catch (error) {
      /** Skip problematic rows but continue table creation */
      continue;
    }
  }
  
  return groupFrame;
}

/**
 * Creates data row for theme (values column only)
 * @param variable Variable data
 * @param mode Mode information
 * @param isLast Whether the row is last in the group
 * @param tableTheme Table theme ('light' or 'dark')
 * @returns FrameNode of data row
 */
async function createThemeDataRow(variable: VariableData, mode: ModeInfo, isLast: boolean, tableTheme: string, showSwatches: boolean = true): Promise<FrameNode> {
  const value = variable.values[mode.modeId];
  const colorValue = variable.colorValues?.[mode.modeId];
  const aliasVariable = variable.aliasVariables?.[mode.modeId];
  
  const valueCell = await createValueCell(value, variable.variableType, TABLE_CONFIG.sizes.columnWidth.value, colorValue, aliasVariable, tableTheme, showSwatches);
  valueCell.name = `${variable.name} - ${mode.name}`;
  
  /** Wrap cell in container for proper spacing */
  const valueContainer = figma.createFrame();
  valueContainer.name = `Value: ${variable.name}`;
  valueContainer.layoutMode = 'HORIZONTAL';
  valueContainer.primaryAxisSizingMode = 'AUTO';
  valueContainer.counterAxisSizingMode = 'AUTO';
  valueContainer.itemSpacing = 0;
  valueContainer.fills = [createSolidFill(getTableColors(tableTheme).dataRow.background)];
  
  /** Round corners for last row */
  if (isLast) {
    valueContainer.bottomLeftRadius = TABLE_CONFIG.radius.header;
    valueContainer.bottomRightRadius = TABLE_CONFIG.radius.header;
  }
  
  valueContainer.appendChild(valueCell);
  return valueContainer;
}

/**
 * Positions table in current user viewport
 * @param tableFrame Table frame to position
 */
function positionTableInViewport(tableFrame: FrameNode): void {
  /** Place table in current visible area (where user is zoomed) */
  figma.currentPage.appendChild(tableFrame);
  
  /** Position table in user's viewport */
  const bounds = tableFrame.absoluteBoundingBox;
  if (bounds) {
    /** Place table in top-left corner of current visible area with small offset */
    tableFrame.x = figma.viewport.center.x - figma.viewport.bounds.width / 2 + 50;
    tableFrame.y = figma.viewport.center.y - figma.viewport.bounds.height / 2 + 50;
  }
  
  /** Select table */
  figma.currentPage.selection = [tableFrame];
  figma.viewport.scrollAndZoomIntoView([tableFrame]);
}

/**
 * Creates table with variables separated by groups with repeating headers
 * Coordinating function that manages the entire table creation process
 * @param variablesData Array of variable data
 * @param modes Array of modes/themes
 */
async function createTableFrame(variablesData: VariableData[], modes: ModeInfo[], tableTheme: string, showDevToken: boolean = true, showSwatches: boolean = true): Promise<void> {
  /** Create main frame for table */
  const tableFrame = figma.createFrame();
  tableFrame.name = 'Variables Table';
  tableFrame.layoutMode = 'HORIZONTAL';
  tableFrame.primaryAxisSizingMode = 'AUTO';
  tableFrame.counterAxisSizingMode = 'AUTO';
  tableFrame.itemSpacing = TABLE_CONFIG.spacing.section;
  tableFrame.cornerRadius = 0;
  tableFrame.fills = [];
  
  /** 1. Group variables by prefixes */
  const groupedVariables = groupVariablesByPrefix(variablesData);
  
  /** 2. Create main table with variables */
  const mainTableFrame = await createMainVariablesTable(groupedVariables, tableTheme, showDevToken, showSwatches);
  tableFrame.appendChild(mainTableFrame);
  
  /** 3. Create groups for each theme */
  const themeFrames = await createThemeVariablesTables(groupedVariables, modes, tableTheme, showSwatches);
  themeFrames.forEach(themeFrame => {
    tableFrame.appendChild(themeFrame);
  });
  
  /** 4. Position table in viewport */
  positionTableInViewport(tableFrame);
}

/**
 * Создает строку заголовка основной таблицы (только Design Token и Dev Token)
 * @returns FrameNode с ячейками заголовков
 */
async function createMainHeaderRow(tableTheme: string, showDevToken: boolean = true): Promise<FrameNode> {
  const headerRow = figma.createFrame();
  headerRow.name = 'Main Header Row';
  headerRow.layoutMode = 'HORIZONTAL';
  headerRow.primaryAxisSizingMode = 'AUTO';
  headerRow.counterAxisSizingMode = 'AUTO';
  headerRow.itemSpacing = 0;
  
  /** Header styles */
  headerRow.fills = [createSolidFill(getTableColors(tableTheme).header.background)];
  
  /** Round only top corners of header */
  headerRow.topLeftRadius = TABLE_CONFIG.radius.header;
  headerRow.topRightRadius = TABLE_CONFIG.radius.header;
  headerRow.bottomLeftRadius = 0;
  headerRow.bottomRightRadius = 0;
  
  /** Design Token column */
  const designTokenHeader = await createHeaderCell('Design Token', TABLE_CONFIG.sizes.columnWidth.designToken, tableTheme);
  headerRow.appendChild(designTokenHeader);
  
  /** Dev Token column (only if showDevToken = true) */
  if (showDevToken) {
    const devTokenHeader = await createHeaderCell('Dev Token', TABLE_CONFIG.sizes.columnWidth.devToken, tableTheme);
    headerRow.appendChild(devTokenHeader);
  }
  
  return headerRow;
}

/**
 * Creates header row for theme
 * @param themeName Theme name
 * @returns FrameNode with theme header
 */
async function createThemeHeaderRow(themeName: string, tableTheme: string): Promise<FrameNode> {
  const headerRow = figma.createFrame();
  headerRow.name = `Theme Header: ${themeName}`;
  headerRow.layoutMode = 'HORIZONTAL';
  headerRow.primaryAxisSizingMode = 'AUTO';
  headerRow.counterAxisSizingMode = 'AUTO';
  headerRow.itemSpacing = 0;
  
  /** Header styles */
  headerRow.fills = [createSolidFill(getTableColors(tableTheme).header.background)];
  
  /** Round only top corners of header */
  headerRow.topLeftRadius = TABLE_CONFIG.radius.header;
  headerRow.topRightRadius = TABLE_CONFIG.radius.header;
  headerRow.bottomLeftRadius = 0;
  headerRow.bottomRightRadius = 0;
  
  /** Create theme header */
  const themeHeader = await createHeaderCell(themeName, TABLE_CONFIG.sizes.columnWidth.value, tableTheme);
  headerRow.appendChild(themeHeader);
  
  return headerRow;
}

/**
 * Creates main table data row (without theme columns)
 * @param variableData Variable data
 * @param isLast Whether the row is last in the group
 * @returns FrameNode with data row
 */
async function createMainDataRow(variableData: VariableData, isLast: boolean, tableTheme: string, showDevToken: boolean = true): Promise<FrameNode> {
  const dataRow = figma.createFrame();
  dataRow.name = `Main Data Row: ${variableData.name}`;
  dataRow.layoutMode = 'HORIZONTAL';
  dataRow.primaryAxisSizingMode = 'AUTO';
  dataRow.counterAxisSizingMode = 'AUTO';
  dataRow.itemSpacing = 0;
  
  /** Data row styles */
  dataRow.fills = [createSolidFill(getTableColors(tableTheme).dataRow.background)];
  
  /** Round only bottom corners for last row */
  if (isLast) {
    dataRow.topLeftRadius = 0;
    dataRow.topRightRadius = 0;
    dataRow.bottomLeftRadius = TABLE_CONFIG.radius.header;
    dataRow.bottomRightRadius = TABLE_CONFIG.radius.header;
  } else {
    /** Middle rows without rounding */
    dataRow.cornerRadius = 0;
  }
  
  /** Design Token cell */
  const designTokenCell = await createDataCell(formatVariableName(variableData.name), TABLE_CONFIG.sizes.columnWidth.designToken, 'design-token', tableTheme);
  dataRow.appendChild(designTokenCell);
  
  /** Dev Token cell (only if showDevToken = true) */
  if (showDevToken) {
    const devTokenCell = await createDataCell(variableData.devToken, TABLE_CONFIG.sizes.columnWidth.devToken, 'dev-token', tableTheme);
    dataRow.appendChild(devTokenCell);
  }
  
  return dataRow;
}

/**
 * Creates data cell for main table
 * @param text Text to display in cell
 * @param width Cell width
 * @param type Cell type (design-token or dev-token)
 * @returns FrameNode with data cell
 */
async function createDataCell(text: string, width: number, type: 'design-token' | 'dev-token', tableTheme: string = 'dark'): Promise<FrameNode> {
  const cell = createBaseCellMemoized(`Data Cell: ${type}`, width, 'VERTICAL');
  
  /** Configure content alignment */
  cell.primaryAxisAlignItems = 'MIN';
  cell.counterAxisAlignItems = 'MIN';
  
  /** Create text */
  const textNodes = await createTextNodesBatch([{ text, fontType: type === 'dev-token' ? 'primary' : 'secondary' }], tableTheme);
  const textNode = textNodes[0];
  textNode.fontSize = APP_CONSTANTS.TEXT_SIZE.HEADER;
  textNode.textAlignHorizontal = 'LEFT';
  textNode.textAlignVertical = 'CENTER';
  
  cell.appendChild(textNode);
  return cell;
}

/**
 * Determines which color to use for visual indicator in cell
 * Prioritizes resolved color values over direct values
 * Returns null for non-color variables
 * @param value Variable value (may contain direct color)
 * @param type Figma variable type
 * @param colorValue Resolved color value (priority)
 * @returns RGB(A) color object or null if color is not defined
 */
function determineColorForIndicator(
  value: string | number | boolean | { r: number; g: number; b: number; a?: number }, 
  type: VariableResolvedDataType, 
  colorValue?: { r: number; g: number; b: number; a?: number } | null
): { r: number; g: number; b: number; a?: number } | null {
  if (type !== 'COLOR') {
    return null;
  }

  /** Priority: first check colorValue (resolved color) */
  if (colorValue && typeof colorValue === 'object' && 'r' in colorValue) {
    return colorValue;
  }
  
  /** If no colorValue, but value contains color directly */
  if (typeof value === 'object' && value && 'r' in value) {
    return value as { r: number; g: number; b: number; a?: number };
  }
  
  return null;
}

/**
 * Creates circular color indicator for displaying color variables
 * Applies binding to alias variable if available, otherwise uses static color
 * Adds thin border for better visibility on any background
 * @param color RGB(A) color for indicator fill
 * @param type Figma variable type
 * @param aliasVariable Alias variable for binding (if available)
 * @returns EllipseNode element with configured color indicator
 */
function createColorIndicator(
  color: { r: number; g: number; b: number; a?: number }, 
  type: VariableResolvedDataType, 
  aliasVariable?: Variable | null,
  tableTheme: string = 'dark'
): EllipseNode {
  const colorCircle = figma.createEllipse();
  colorCircle.resize(TABLE_CONFIG.sizes.colorCircle, TABLE_CONFIG.sizes.colorCircle);
  
  const colors = getTableColors(tableTheme);
  
  /** Check if we have alias variable to apply */
  if (aliasVariable && type === 'COLOR') {
    try {
      /** Create initial SOLID fill */
      const solidFill = createSolidFill(
        { r: color.r, g: color.g, b: color.b },
        color.a !== undefined ? color.a : 1
      );
      
      /** Apply variable alias to fill */
      const aliasedFill = figma.variables.setBoundVariableForPaint(solidFill, 'color', aliasVariable);
      colorCircle.fills = [aliasedFill];
    } catch (error) {
      /** Fallback to regular color */
      colorCircle.fills = [createSolidFill(
        { r: color.r, g: color.g, b: color.b },
        color.a !== undefined ? color.a : 1
      )];
    }
  } else {
    /** Use regular color if no alias */
    colorCircle.fills = [createSolidFill(
      { r: color.r, g: color.g, b: color.b },
      color.a !== undefined ? color.a : 1
    )];
  }
  
  colorCircle.strokes = [createSolidFill(colors.colorCircle.stroke, 0.12)];
  colorCircle.strokeWeight = 1;
  
  return colorCircle;
}

/**
 * Форматирует различные типы значений переменных для читаемого отображения
 * Обрабатывает строки, числа, булевы значения и цветовые объекты
 * Применяет специальное форматирование для имен переменных и цветов
 * @param value Значение переменной любого поддерживаемого типа
 * @returns Отформатированная строка для отображения в таблице
 */
function formatValueForDisplay(value: string | number | boolean | { r: number; g: number; b: number; a?: number }): string {
  if (typeof value === 'string') {
    // Для строковых значений проверяем, является ли это названием переменной
    if (value.includes('/')) {
      // Это название переменной - форматируем его
      return formatVariableName(value);
    } else {
      // Обычная строка - показываем как есть
      return value;
    }
  } else if (typeof value === 'number') {
    return formatNumber(value);
  } else if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  } else if (typeof value === 'object' && value && 'r' in value) {
    // Это прямое значение цвета - показываем цвет с учетом opacity
    return formatColor(value as { r: number; g: number; b: number; a?: number });
  } else {
    return String(value);
  }
}

/**
 * Создает текстовый элемент с единообразным стилем для значений переменных
 * Применяет основной шрифт, размер и цвет согласно дизайн-системе
 * @param displayValue Отформатированное значение для отображения
 * @param tableTheme Тема таблицы для определения цветов
 * @returns Промис с настроенным текстовым элементом
 */
async function createValueText(displayValue: string, tableTheme: string = 'dark'): Promise<TextNode> {
  const textNode = figma.createText();
  textNode.fontName = await loadFontWithFallback('primary');
  textNode.characters = displayValue;
  textNode.fontSize = APP_CONSTANTS.TEXT_SIZE.BODY;
  
  const colors = getTableColors(tableTheme);
  textNode.fills = [createSolidFill(colors.text.primary)];
  textNode.textAlignHorizontal = 'LEFT';
  textNode.textAlignVertical = 'CENTER';
  
  return textNode;
}

/**
 * Создает комплексную ячейку для отображения значения переменной
 * Включает цветовой индикатор для цветовых переменных и форматированный текст
 * Использует горизонтальный layout для размещения индикатора и текста
 * @param value Значение переменной для отображения
 * @param type Тип переменной Figma (определяет наличие цветового индикатора)
 * @param width Ширина ячейки в пикселях
 * @param colorValue Разрешенное цветовое значение (для цветовых переменных)
 * @param aliasVariable Переменная-алиас для привязки цвета (опционально)
 * @param tableTheme - Тема таблицы ('light' или 'dark')
 * @returns Промис с настроенной ячейкой значения
 */
async function createValueCell(
  value: string | number | boolean | { r: number; g: number; b: number; a?: number }, 
  type: VariableResolvedDataType, 
  width: number, 
  colorValue?: { r: number; g: number; b: number; a?: number } | null, 
  aliasVariable?: Variable | null,
  tableTheme: string = 'dark',
  showSwatches: boolean = true
): Promise<FrameNode> {
  const cell = createBaseCellMemoized('Value Cell', width, 'HORIZONTAL');
  
  // Настраиваем выравнивание контента
  cell.primaryAxisAlignItems = 'MIN'; // Выравнивание по левому краю (для горизонтального layout)
  cell.counterAxisAlignItems = 'CENTER'; // Центрирование по вертикали
  
  // Определяем цвет для кружка
  const colorForCircle = determineColorForIndicator(value, type, colorValue);
  
  // Создаем цветной кружок для цветовых переменных (только если showSwatches = true)
  if (colorForCircle && showSwatches) {
    const colorCircle = createColorIndicator(colorForCircle, type, aliasVariable, tableTheme);
    cell.appendChild(colorCircle);
  }
  
  // Форматируем и создаем текст значения
  const displayValue = formatValueForDisplay(value);
  const textNode = await createValueText(displayValue, tableTheme);
  cell.appendChild(textNode);
  
  return cell;
}

/**
 * Создает ячейку заголовка таблицы с единообразным стилем
 * Применяет специальный шрифт заголовка и выравнивание по левому краю
 * @param text Текст заголовка для отображения
 * @param width Ширина ячейки в пикселях
 * @param tableTheme Тема таблицы для определения цветов
 * @returns Промис с настроенной ячейкой заголовка
 */
async function createHeaderCell(text: string, width: number, tableTheme: string = 'dark'): Promise<FrameNode> {
  const cell = createBaseCellMemoized(`Header: ${text}`, width, 'VERTICAL');
  
  // Настраиваем выравнивание контента
  cell.primaryAxisAlignItems = 'MIN';
  cell.counterAxisAlignItems = 'MIN';
  
  // Создаем текст
  const textNodes = await createTextNodesBatch([{ text, fontType: 'header' }], tableTheme);
  const textNode = textNodes[0];
  textNode.fontSize = APP_CONSTANTS.TEXT_SIZE.HEADER;
  textNode.textAlignHorizontal = 'LEFT';
  textNode.textAlignVertical = 'CENTER';
  
  cell.appendChild(textNode);
  return cell;
}

/**
 * Специализированный класс ошибок для проблем с переменными
 * Содержит дополнительную информацию о проблемной переменной
 */
class _VariableError extends Error {
  constructor(message: string, public readonly variableName?: string) {
    super(message);
    this.name = 'VariableError';
  }
}

/**
 * Специализированный класс ошибок для проблем с коллекциями
 * Содержит дополнительную информацию о проблемной коллекции
 */
class _CollectionError extends Error {
  constructor(message: string, public readonly collectionId?: string) {
    super(message);
    this.name = 'CollectionError';
  }
}

/**
 * Логирует ошибки в консоль с временными метками и контекстом
 * Обеспечивает структурированное логирование для отладки
 * @param error Ошибка для логирования
 * @param context Дополнительный контекст выполнения
 */
function logError(error: Error, context?: string): void {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` [${context}]` : '';
  console.error(`${timestamp}${contextStr}: ${error.name}: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
}

/**
 * Обертка для безопасного выполнения асинхронных операций
 * Перехватывает ошибки, логирует их и возвращает null вместо падения
 * @param fn Асинхронная функция для выполнения
 * @param context Контекст для логирования ошибок
 * @returns Промис с результатом функции или null при ошибке
 */
async function _safeExecute<T>(fn: () => Promise<T>, context?: string): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), context);
    return null;
  }
}

/**
 * Интерфейс для пользовательских настроек
 */
interface UserSettings {
  tableTheme: 'light' | 'dark';
  showDevToken: boolean;
  showSwatches: boolean;
}

/**
 * Настройки по умолчанию
 */
const DEFAULT_SETTINGS: UserSettings = {
  tableTheme: 'dark',
  showDevToken: true,
  showSwatches: true
};

/**
 * Загружает сохраненные настройки пользователя
 */
async function loadUserSettings(): Promise<void> {
  try {
    const savedSettings = await figma.clientStorage.getAsync('userSettings');
    const settings: UserSettings = savedSettings || DEFAULT_SETTINGS;
    
    // Отправляем настройки в UI
    figma.ui.postMessage({
      type: 'settings-loaded',
      settings: settings
    });
    
    console.log('User settings loaded:', settings);
  } catch (error) {
    console.error('Failed to load user settings:', error);
    // В случае ошибки отправляем настройки по умолчанию
    figma.ui.postMessage({
      type: 'settings-loaded',
      settings: DEFAULT_SETTINGS
    });
  }
}

/**
 * Сохраняет настройки пользователя
 */
async function saveUserSettings(settings: UserSettings): Promise<void> {
  try {
    await figma.clientStorage.setAsync('userSettings', settings);
    console.log('User settings saved:', settings);
  } catch (error) {
    console.error('Failed to save user settings:', error);
  }
}
