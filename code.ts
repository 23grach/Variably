// Variables Sheet Plugin for Figma
// Автоматически создает таблицу со всеми переменными из выбранной коллекции

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// This shows the HTML page in "ui.html".
figma.showUI(__html__, { width: 340, height: 500 });

// Interface definitions
interface VariableData {
  name: string;
  devToken: string;
  variableType: VariableResolvedDataType;
  values: { [modeId: string]: string | number | boolean | { r: number; g: number; b: number; a?: number } };
  variable: Variable;
  colorValues?: { [modeId: string]: { r: number; g: number; b: number; a?: number } | null };
}

interface ModeInfo {
  modeId: string;
  name: string;
}

interface GroupInfo {
  prefix: string;
  count: number;
}

// Message handlers
figma.ui.onmessage = async (msg: { type: string; collectionId?: string; collectionName?: string; modes?: ModeInfo[]; groups?: GroupInfo[] }) => {
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
      
      case 'create-table':
        if (msg.collectionId && msg.collectionName && msg.modes && msg.groups) {
          await createVariablesTable(msg.collectionId, msg.collectionName, msg.modes, msg.groups);
        }
        break;
      
      case 'cancel':
        figma.closePlugin();
        break;
    }
  } catch (error) {
    console.error('Plugin error:', error);
    figma.ui.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
};

/**
 * Загружает все коллекции переменных и отправляет их в UI
 */
async function loadCollections(): Promise<void> {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    
    const collectionsData = collections.map(collection => ({
      id: collection.id,
      name: collection.name,
      modes: collection.modes
    }));

    figma.ui.postMessage({
      type: 'collections-loaded',
      collections: collectionsData
    });
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to load collections: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
}

/**
 * Загружает группы переменных для выбранной коллекции
 */
async function loadGroups(collectionId: string): Promise<void> {
  try {
    console.log('Loading groups for collection:', collectionId);
    
    // Получаем все переменные из коллекции
    const allVariables = await figma.variables.getLocalVariablesAsync();
    const collectionVariables = allVariables.filter(variable => 
      variable.variableCollectionId === collectionId
    );
    
    // Группируем переменные по префиксам
    const groupsMap = new Map<string, number>();
    
    collectionVariables.forEach(variable => {
      const prefix = variable.name.split('/')[0] || 'other';
      groupsMap.set(prefix, (groupsMap.get(prefix) || 0) + 1);
    });
    
    // Преобразуем в массив и сортируем
    const groups: GroupInfo[] = Array.from(groupsMap.entries())
      .map(([prefix, count]) => ({ prefix, count }))
      .sort((a, b) => a.prefix.localeCompare(b.prefix, 'en', { sensitivity: 'base' }));
    
    console.log('Groups found:', groups);
    
    figma.ui.postMessage({
      type: 'groups-loaded',
      groups: groups
    });
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to load groups: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
}

/**
 * Создает таблицу переменных для выбранной коллекции и тем
 */
async function createVariablesTable(collectionId: string, collectionName: string, modes: ModeInfo[], groups: GroupInfo[]): Promise<void> {
  try {
    console.log('Starting table creation...', { collectionId, collectionName, modes, groups });
    
    // Получаем коллекцию
    const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (!collection) {
      throw new Error('Collection not found');
    }
    console.log('Collection found:', collection.name);

    // Получаем все переменные из коллекции
    const allVariables = await figma.variables.getLocalVariablesAsync();
    console.log('Total variables in file:', allVariables.length);
    
    const collectionVariables = allVariables.filter(variable => 
      variable.variableCollectionId === collectionId
    );
    console.log('Variables in collection:', collectionVariables.length);

    // Фильтруем переменные по выбранным группам
    const selectedPrefixes = groups.map(g => g.prefix);
    console.log('Selected prefixes:', selectedPrefixes);
    
    const filteredVariables = collectionVariables.filter(variable => {
      const prefix = variable.name.split('/')[0] || 'other';
      return selectedPrefixes.includes(prefix);
    });
    
    console.log('Variables after group filtering:', filteredVariables.length);
    console.log('Filtered variable names:', filteredVariables.map(v => v.name));

    if (filteredVariables.length === 0) {
      throw new Error('No variables found in selected groups');
    }

    // Подготавливаем данные переменных
    console.log('Preparing variables data...');
    const variablesData: VariableData[] = await Promise.all(
      filteredVariables.map(async (variable) => {
        console.log('=== PROCESSING VARIABLE ===');
        console.log('Variable name:', variable.name);
        console.log('Variable resolvedType:', variable.resolvedType);
        console.log('Variable valuesByMode:', variable.valuesByMode);
        console.log('Is COLOR type?', variable.resolvedType === 'COLOR');
        
        const values: { [modeId: string]: string | number | boolean | { r: number; g: number; b: number; a?: number } } = {};
        const colorValues: { [modeId: string]: { r: number; g: number; b: number; a?: number } | null } = {};
        
        // Получаем значения для каждой темы
        for (const mode of modes) {
          const rawValue = variable.valuesByMode[mode.modeId];
          console.log(`--- Mode: ${mode.name} (${mode.modeId}) ---`);
          console.log('Raw value:', rawValue);
          console.log('Raw value type:', typeof rawValue);
          console.log('Raw value structure:', JSON.stringify(rawValue, null, 2));
          
          // Резолвим значение для отображения
          values[mode.modeId] = await resolveVariableValue(variable, mode.modeId, rawValue);
          console.log('Resolved display value:', values[mode.modeId]);
          
          // Для цветовых переменных также получаем фактический цвет
          if (variable.resolvedType === 'COLOR') {
            console.log(`🎨 Processing COLOR variable ${variable.name} for mode ${mode.name}`);
            console.log(`🎨 Passing RAW value to resolveColorValue:`, rawValue);
            const resolvedColor = await resolveColorValue(variable, mode.modeId, rawValue);
            console.log(`🎨 Resolved color result:`, resolvedColor);
            colorValues[mode.modeId] = resolvedColor;
            
            if (resolvedColor) {
              console.log(`✅ Color resolved successfully for ${variable.name}[${mode.name}]`);
            } else {
              console.log(`❌ Color resolution failed for ${variable.name}[${mode.name}]`);
            }
          } else {
            console.log(`⚪ Variable ${variable.name} is not COLOR type (${variable.resolvedType})`);
          }
        }

        const result: VariableData = {
          name: variable.name,
          devToken: generateDevToken(variable.name),
          variableType: variable.resolvedType,
          values,
          variable,
          colorValues: variable.resolvedType === 'COLOR' ? colorValues : undefined
        };
        
        console.log('=== VARIABLE PROCESSING RESULT ===');
        console.log('Variable name:', result.name);
        console.log('Variable type:', result.variableType);
        console.log('Has colorValues:', !!result.colorValues);
        console.log('ColorValues content:', result.colorValues);
        console.log('=== END VARIABLE PROCESSING ===\n');
        
        return result;
      })
    );

    console.log('Variables data prepared:', variablesData.length);
    
    // Сортируем переменные по префиксам, а затем по алфавиту внутри групп
    console.log('Sorting variables by prefix groups and alphabetically...');
    const sortedVariablesData = variablesData.sort((a, b) => {
      // Извлекаем префикс (первая часть до первого слеша)
      const getPrefixAndPath = (name: string) => {
        const parts = name.split('/');
        const prefix = parts[0] || '';
        return { prefix, fullPath: name };
      };
      
      const aData = getPrefixAndPath(a.name);
      const bData = getPrefixAndPath(b.name);
      
      // Сначала сортируем по префиксам
      const prefixComparison = aData.prefix.localeCompare(bData.prefix, 'en', { sensitivity: 'base' });
      if (prefixComparison !== 0) {
        return prefixComparison;
      }
      
      // Если префиксы одинаковые, сортируем по полному пути
      return aData.fullPath.localeCompare(bData.fullPath, 'en', { sensitivity: 'base' });
    });
    
    // Выводим информацию о группировке
    console.log('Variables grouped and sorted:');
    let currentPrefix = '';
    let groupCount = 0;
    sortedVariablesData.forEach((variable) => {
      const prefix = variable.name.split('/')[0] || '';
      if (prefix !== currentPrefix) {
        currentPrefix = prefix;
        groupCount++;
        console.log(`📁 Group ${groupCount}: "${prefix}/" - starting with: ${variable.name}`);
      }
    });
    console.log(`Total groups: ${groupCount}`);
    
    // Создаем таблицу
    await createTableFrame(sortedVariablesData, modes);
    
    figma.closePlugin('Variables table created successfully!');
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to create table: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
}

/**
 * Генерирует dev token из названия переменной
 */
function generateDevToken(variableName: string): string {
  // Приводим к нижнему регистру, заменяем слеши и пробелы на дефисы
  const cleanName = variableName
    .toLowerCase()
    .replace(/\//g, '-')        // Заменяем слеши на дефисы
    .replace(/\s+/g, '-')       // Заменяем пробелы на дефисы
    .replace(/[^a-z0-9\-_]/g, ''); // Удаляем все остальные специальные символы
  
  return `var(--${cleanName})`;
}

/**
 * Форматирует цвет для красивого отображения
 */
function formatColor(color: { r: number; g: number; b: number; a?: number }): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  
  // Формируем hex код
  const hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  
  // Если есть альфа-канал и он не равен 1 (100%)
  if (color.a !== undefined && color.a !== 1) {
    const percentage = Math.round(color.a * 100);
    return `${hexColor} ${percentage}%`;
  }
  
  // Стандартный hex код для непрозрачных цветов
  return hexColor;
}

/**
 * Форматирует число для красивого отображения
 */
function formatNumber(num: number): string {
  // Если это целое число, показываем без десятичных знаков
  if (Number.isInteger(num)) {
    return num.toString();
  }
  
  // Округляем до 3 знаков после запятой для точности
  const rounded = Math.round(num * 1000) / 1000;
  
  // Преобразуем в строку и убираем лишние нули в конце
  let result = rounded.toString();
  
  // Если число имеет десятичную часть, убираем trailing zeros
  if (result.includes('.')) {
    result = result.replace(/\.?0+$/, '');
  }
  
  return result;
}

/**
 * Резолвит значение переменной, возвращая отображаемое значение
 */
async function resolveVariableValue(variable: Variable, modeId: string, value: unknown): Promise<string | number | boolean | { r: number; g: number; b: number; a?: number }> {
  console.log(`📝 resolveVariableValue for ${variable.name}[${modeId}]`);
  console.log('📝 Input value:', value);
  console.log('📝 Input value type:', typeof value);
  console.log('📝 Input value JSON:', JSON.stringify(value, null, 2));
  
  if (value === undefined || value === null) {
    console.log('📝 Returning empty string for undefined/null');
    return '';
  }

  // Проверяем на VARIABLE_ALIAS
  if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS' && 'id' in value) {
    console.log('📝 Value is VARIABLE_ALIAS, getting referenced variable name');
    console.log('📝 Alias ID:', value.id);
    try {
      const referencedVariable = await figma.variables.getVariableByIdAsync(value.id as string);
      if (referencedVariable) {
        console.log(`📝 Alias points to: ${referencedVariable.name}`);
        // Для alias переменных возвращаем имя референсной переменной
        return referencedVariable.name;
      } else {
        console.log('📝 Referenced variable not found');
        return 'Unknown variable';
      }
    } catch (error) {
      console.error('📝 Error resolving alias:', error);
      return 'Error resolving alias';
    }
  }

  // Для прямых значений
  if (typeof value === 'object' && value !== null && 'r' in value) {
    console.log('📝 Value is color object, returning as-is');
    // Это цветовое значение - возвращаем как есть для дальнейшей обработки
    return value as { r: number; g: number; b: number; a?: number };
  }

  // Для остальных типов возвращаем как есть
  console.log('📝 Returning value as-is:', value);
  return value as string | number | boolean;
}

/**
 * Резолвит цветовое значение переменной, включая alias (рекурсивно)
 */
async function resolveColorValue(variable: Variable, modeId: string, value: unknown): Promise<{ r: number; g: number; b: number; a?: number } | null> {
  console.log(`🔍 resolveColorValue called for variable: ${variable.name}, modeId: ${modeId}`);
  console.log('🔍 Input value:', value);
  console.log('🔍 Value type:', typeof value);
  console.log('🔍 Value JSON:', JSON.stringify(value, null, 2));
  
  // Проверяем на undefined и null
  if (value === undefined || value === null) {
    console.log('❌ Value is undefined or null, returning null');
    return null;
  }

  // Если это alias (ссылка на другую переменную)
  if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS' && 'id' in value) {
    console.log('🔗 Value is VARIABLE_ALIAS, resolving alias:', value.id);
    try {
      const referencedVariable = await figma.variables.getVariableByIdAsync(value.id as string);
      console.log('🔗 Referenced variable found:', referencedVariable?.name, 'type:', referencedVariable?.resolvedType);
      
      if (referencedVariable && referencedVariable.resolvedType === 'COLOR') {
        console.log('🔗 Referenced variable modes:', Object.keys(referencedVariable.valuesByMode));
        
        // Сначала пробуем тот же режим
        let refValue = referencedVariable.valuesByMode[modeId];
        console.log(`🔗 Trying same mode ${modeId}:`, refValue);
        
        // Если в том же режиме нет значения, пробуем первый доступный режим
        if (refValue === undefined) {
          const availableModes = Object.keys(referencedVariable.valuesByMode);
          if (availableModes.length > 0) {
            const firstMode = availableModes[0];
            refValue = referencedVariable.valuesByMode[firstMode];
            console.log(`🔗 Fallback to first available mode ${firstMode}:`, refValue);
          }
        }
        
        if (refValue !== undefined) {
          console.log(`🔗 Recursively resolving referenced variable ${referencedVariable.name} with value:`, refValue);
          const recursiveResult = await resolveColorValue(referencedVariable, modeId, refValue);
          console.log('🔗 Recursive resolution result:', recursiveResult);
          return recursiveResult;
        } else {
          console.log('❌ No value found in any mode for referenced variable');
          return null;
        }
      } else {
        console.log('❌ Referenced variable is not a COLOR or does not exist');
        return null;
      }
    } catch (error) {
      console.error('❌ Error resolving alias variable:', error);
      return null;
    }
  }

  // Если это строка, которая может быть именем переменной (для случаев, когда resolveVariableValue уже разрешил alias)
  if (typeof value === 'string' && value.includes('/')) {
    console.log('🔗 Value is string that looks like variable name, trying to find variable:', value);
    try {
      // Получаем все переменные и ищем по имени
      const allVariables = await figma.variables.getLocalVariablesAsync();
      const foundVariable = allVariables.find(v => v.name === value && v.resolvedType === 'COLOR');
      
      if (foundVariable) {
        console.log('🔗 Found variable by name:', foundVariable.name);
        const foundValue = foundVariable.valuesByMode[modeId];
        if (foundValue !== undefined) {
          console.log('🔗 Recursively resolving found variable with value:', foundValue);
          return await resolveColorValue(foundVariable, modeId, foundValue);
        } else {
          // Пробуем первый доступный режим
          const availableModes = Object.keys(foundVariable.valuesByMode);
          if (availableModes.length > 0) {
            const firstMode = availableModes[0];
            const fallbackValue = foundVariable.valuesByMode[firstMode];
            console.log(`🔗 Using fallback mode ${firstMode} for variable ${foundVariable.name}:`, fallbackValue);
            return await resolveColorValue(foundVariable, firstMode, fallbackValue);
          }
        }
      } else {
        console.log('❌ Could not find variable by name:', value);
      }
    } catch (error) {
      console.error('❌ Error finding variable by name:', error);
    }
  }

  // Для прямых цветовых значений
  if (typeof value === 'object' && value !== null && 'r' in value && 'g' in value && 'b' in value) {
    console.log('✅ Value is direct color object, returning it');
    const colorResult = value as { r: number; g: number; b: number; a?: number };
    console.log('✅ Color result:', colorResult);
    return colorResult;
  }
  
  console.log('❌ Value does not match any expected format for color');
  console.log('❌ Value keys:', typeof value === 'object' && value !== null ? Object.keys(value) : 'N/A');
  return null;
}

/**
 * Создает фрейм с таблицей переменных
 */
async function createTableFrame(variablesData: VariableData[], modes: ModeInfo[]): Promise<void> {
  console.log('Creating table frame with', variablesData.length, 'variables and', modes.length, 'modes');
  
  // Создаем основной фрейм для таблицы
  const tableFrame = figma.createFrame();
  tableFrame.name = 'Variables Table';
  tableFrame.layoutMode = 'VERTICAL';
  tableFrame.primaryAxisSizingMode = 'AUTO';
  tableFrame.counterAxisSizingMode = 'AUTO';
  tableFrame.itemSpacing = 0;
  
  // Стили для таблицы
  tableFrame.cornerRadius = 16;
  tableFrame.strokes = [{
    type: 'SOLID',
    color: { r: 163/255, g: 171/255, b: 187/255 },
    opacity: 0.12
  }];
  tableFrame.strokeWeight = 1;
  
  // Создаем заголовок таблицы
  console.log('Creating header row...');
  try {
    const headerRow = await createHeaderRow(modes);
    console.log('Header row created, adding to table...');
    tableFrame.appendChild(headerRow);
    console.log('Header row added to table successfully');
  } catch (error) {
    console.error('Error creating header row:', error);
    throw error;
  }
  
  // Создаем строки данных
  console.log('Creating data rows...');
  for (let i = 0; i < variablesData.length; i++) {
    console.log(`Creating row ${i + 1}/${variablesData.length} for variable:`, variablesData[i].name);
    try {
      const dataRow = await createDataRow(variablesData[i], modes, i === variablesData.length - 1);
      tableFrame.appendChild(dataRow);
      console.log(`Row ${i + 1} created successfully`);
    } catch (error) {
      console.error(`Error creating row ${i + 1}:`, error);
    }
  }
  
  // Размещаем таблицу по центру страницы
  figma.currentPage.appendChild(tableFrame);
  
  // Центрируем таблицу
  const bounds = tableFrame.absoluteBoundingBox;
  if (bounds) {
    tableFrame.x = figma.viewport.center.x - bounds.width / 2;
    tableFrame.y = figma.viewport.center.y - bounds.height / 2;
  }
  
  // Выбираем таблицу
  figma.currentPage.selection = [tableFrame];
  figma.viewport.scrollAndZoomIntoView([tableFrame]);
}

/**
 * Создает строку заголовка таблицы
 */
async function createHeaderRow(modes: ModeInfo[]): Promise<FrameNode> {
  console.log('createHeaderRow called with modes:', modes.length);
  // Шрифт уже загружен в createTableFrame
  
  const headerRow = figma.createFrame();
  headerRow.name = 'Header Row';
  headerRow.layoutMode = 'HORIZONTAL';
  headerRow.primaryAxisSizingMode = 'AUTO';
  headerRow.counterAxisSizingMode = 'AUTO';
  headerRow.itemSpacing = 0;
  console.log('Header row frame created');
  
  // Стили заголовка
  headerRow.fills = [{ type: 'SOLID', color: { r: 29/255, g: 30/255, b: 32/255 } }];
  headerRow.strokes = [{
    type: 'SOLID',
    color: { r: 163/255, g: 171/255, b: 187/255 },
    opacity: 0.12
  }];
  headerRow.strokeWeight = 1;
  
  // Design Token колонка
  console.log('Creating Design Token header cell...');
  const designTokenHeader = await createHeaderCell('Design Token', 480);
  headerRow.appendChild(designTokenHeader);
  console.log('Design Token header cell created');
  
  // Dev Token колонка
  console.log('Creating Dev Token header cell...');
  const devTokenHeader = await createHeaderCell('Dev Token', 552);
  headerRow.appendChild(devTokenHeader);
  console.log('Dev Token header cell created');
  
  // Колонки для каждой темы
  console.log('Creating mode header cells...', modes.length);
  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i];
    console.log(`Creating mode header ${i + 1}/${modes.length}: ${mode.name}`);
    try {
      const modeHeader = await createHeaderCell(mode.name, 560);
      headerRow.appendChild(modeHeader);
      console.log(`Mode header ${i + 1} created successfully`);
    } catch (error) {
      console.error(`Error creating mode header ${i + 1}:`, error);
      throw error;
    }
  }
  
  console.log('Header row completed');
  return headerRow;
}

/**
 * Создает ячейку заголовка
 */
async function createHeaderCell(text: string, width: number): Promise<FrameNode> {
  console.log(`createHeaderCell called for: "${text}", width: ${width}`);
  const cell = figma.createFrame();
  cell.name = `Header: ${text}`;
  cell.layoutMode = 'VERTICAL';
  cell.primaryAxisSizingMode = 'FIXED';
  cell.counterAxisSizingMode = 'AUTO';
  cell.resize(width, 48);
  cell.paddingLeft = 16;
  cell.paddingRight = 16;
  cell.paddingTop = 12;
  cell.paddingBottom = 12;
  cell.itemSpacing = 0;
  console.log('Header cell frame setup completed');
  
  // Стили ячейки
  cell.fills = [{ type: 'SOLID', color: { r: 29/255, g: 30/255, b: 32/255 } }];
  
  // Добавляем правую границу (кроме последней ячейки)
  cell.strokes = [{
    type: 'SOLID',
    color: { r: 163/255, g: 171/255, b: 187/255 },
    opacity: 0.12
  }];
  cell.strokeWeight = 1;
  cell.strokeAlign = 'INSIDE';
  
  // Создаем текст
  console.log('Creating header text node...');
  const textNode = figma.createText();
  console.log('Text node created, loading font for this specific node...');
  
  // Используем системный шрифт, который гарантированно доступен
  console.log('Loading Roboto font...');
  try {
    await figma.loadFontAsync({ family: "Roboto", style: "Medium" });
    console.log('Roboto Medium loaded successfully');
    textNode.fontName = { family: "Roboto", style: "Medium" };
  } catch (error) {
    console.warn('Roboto Medium not available, trying Regular:', error);
    try {
      await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
      console.log('Roboto Regular loaded successfully');
      textNode.fontName = { family: "Roboto", style: "Regular" };
    } catch (error2) {
      console.error('No Roboto available, using default font:', error2);
      // Оставляем дефолтный шрифт - не устанавливаем fontName
    }
  }
  
  // Теперь устанавливаем текст ПОСЛЕ загрузки шрифта
  textNode.characters = text;
  console.log('Characters set');
  textNode.fontSize = 16;
  console.log('Font size set');
  
  textNode.fills = [{ type: 'SOLID', color: { r: 154/255, g: 161/255, b: 177/255 } }];
  textNode.textAlignHorizontal = 'LEFT';
  textNode.textAlignVertical = 'CENTER';
  console.log('Text properties set, adding to cell...');
  
  cell.appendChild(textNode);
  console.log(`Header cell "${text}" completed`);
  
  return cell;
}

/**
 * Создает строку данных для переменной
 */
async function createDataRow(variableData: VariableData, modes: ModeInfo[], isLast: boolean): Promise<FrameNode> {
  console.log('createDataRow called for:', variableData.name);
  // Шрифты уже загружены в createTableFrame
  
  console.log('Creating data row frame...');
  const dataRow = figma.createFrame();
  dataRow.name = `Data Row: ${variableData.name}`;
  dataRow.layoutMode = 'HORIZONTAL';
  dataRow.primaryAxisSizingMode = 'AUTO';
  dataRow.counterAxisSizingMode = 'AUTO';
  dataRow.itemSpacing = 0;
  console.log('Data row frame created');
  
  // Стили строки данных
  dataRow.fills = [{ type: 'SOLID', color: { r: 20/255, g: 20/255, b: 21/255 } }];
  
  // Добавляем верхнюю границу
  dataRow.strokes = [{
    type: 'SOLID',
    color: { r: 163/255, g: 171/255, b: 187/255 },
    opacity: 0.12
  }];
  dataRow.strokeWeight = 1;
  dataRow.strokeAlign = 'INSIDE';
  
  // Если это последняя строка, добавляем нижнюю границу
  if (isLast) {
    // Добавляем дополнительную границу снизу через отдельный stroke
    dataRow.strokes = [
      {
        type: 'SOLID',
        color: { r: 163/255, g: 171/255, b: 187/255 },
        opacity: 0.12
      }
    ];
  }
  
  // Design Token ячейка
  console.log('Creating design token cell...');
  const designTokenCell = await createDataCell(variableData.name, 480, 'design-token');
  dataRow.appendChild(designTokenCell);
  console.log('Design token cell created');
  
  // Dev Token ячейка
  console.log('Creating dev token cell...');
  const devTokenCell = await createDataCell(variableData.devToken, 552, 'dev-token');
  dataRow.appendChild(devTokenCell);
  console.log('Dev token cell created');
  
  // Ячейки значений для каждой темы
  console.log('📊 === CREATING VALUE CELLS ===');
  console.log('📊 Variable:', variableData.name);
  console.log('📊 Variable type:', variableData.variableType);
  console.log('📊 Modes count:', modes.length);
  console.log('📊 Variable colorValues object:', variableData.colorValues);
  console.log('📊 Has colorValues:', !!variableData.colorValues);
  
  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i];
    const value = variableData.values[mode.modeId];
    const colorValue = variableData.colorValues?.[mode.modeId];
    
    console.log(`📊 --- Creating value cell ${i + 1}/${modes.length} for mode ${mode.name} ---`);
    console.log(`📊 Variable: ${variableData.name} (type: ${variableData.variableType})`);
    console.log(`📊 Mode ID: ${mode.modeId}`);
    console.log(`📊 Display value:`, value);
    console.log(`📊 Display value type:`, typeof value);
    console.log(`📊 Color value:`, colorValue);
    console.log(`📊 Color value type:`, typeof colorValue);
    console.log(`📊 colorValues[${mode.modeId}]:`, variableData.colorValues?.[mode.modeId]);
    
    try {
      const valueCell = await createValueCell(value, variableData.variableType, 560, colorValue);
      dataRow.appendChild(valueCell);
      console.log(`📊 ✅ Value cell ${i + 1} created successfully`);
    } catch (error) {
      console.error(`📊 ❌ Error creating value cell ${i + 1}:`, error);
      throw error; // Re-throw to stop execution
    }
  }
  
  console.log('📊 === END CREATING VALUE CELLS ===');
  
  console.log('Data row completed for:', variableData.name);
  return dataRow;
}

/**
 * Создает обычную ячейку данных
 */
async function createDataCell(text: string, width: number, type: 'design-token' | 'dev-token'): Promise<FrameNode> {
  const cell = figma.createFrame();
  cell.name = `Cell: ${text}`;
  cell.layoutMode = 'HORIZONTAL';
  cell.primaryAxisSizingMode = 'FIXED';
  cell.counterAxisSizingMode = 'AUTO';
  cell.resize(width, 48);
  cell.paddingLeft = 16;
  cell.paddingRight = 16;
  cell.paddingTop = 12;
  cell.paddingBottom = 12;
  cell.itemSpacing = 12;
  
  // Стили ячейки
  cell.fills = [{ type: 'SOLID', color: { r: 20/255, g: 20/255, b: 21/255 } }];
  
  // Добавляем правую границу
  cell.strokes = [{
    type: 'SOLID',
    color: { r: 163/255, g: 171/255, b: 187/255 },
    opacity: 0.12
  }];
  cell.strokeWeight = 1;
  cell.strokeAlign = 'INSIDE';
  
  // Создаем текст
  const textNode = figma.createText();
  
  // Загружаем шрифт перед использованием
  try {
    await figma.loadFontAsync({ family: "JetBrains Mono", style: "Medium" });
    textNode.fontName = { family: "JetBrains Mono", style: "Medium" };
  } catch (error) {
    try {
      await figma.loadFontAsync({ family: "Inter", style: "Medium" });
      textNode.fontName = { family: "Inter", style: "Medium" };
    } catch (error2) {
      // Используем системный шрифт как последний вариант
      await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
      textNode.fontName = { family: "Roboto", style: "Regular" };
    }
  }
  
  textNode.characters = text;
  textNode.fontSize = 16;
  
  // Цвет текста зависит от типа
  if (type === 'design-token') {
    textNode.fills = [{ type: 'SOLID', color: { r: 240/255, g: 242/255, b: 245/255 } }];
  } else {
    textNode.fills = [{ type: 'SOLID', color: { r: 154/255, g: 161/255, b: 177/255 } }];
  }
  
  textNode.textAlignHorizontal = 'LEFT';
  textNode.textAlignVertical = 'CENTER';
  
  cell.appendChild(textNode);
  
  return cell;
}

/**
 * Создает ячейку значения с поддержкой разных типов переменных
 */
async function createValueCell(value: string | number | boolean | { r: number; g: number; b: number; a?: number }, type: VariableResolvedDataType, width: number, colorValue?: { r: number; g: number; b: number; a?: number } | null): Promise<FrameNode> {
  console.log('createValueCell called with:', { value, type, width });
  const cell = figma.createFrame();
  cell.name = `Value Cell`;
  cell.layoutMode = 'HORIZONTAL';
  cell.primaryAxisSizingMode = 'FIXED';
  cell.counterAxisSizingMode = 'AUTO';
  cell.resize(width, 48);
  cell.paddingLeft = 16;
  cell.paddingRight = 16;
  cell.paddingTop = 12;
  cell.paddingBottom = 12;
  cell.itemSpacing = 12;
  console.log('Value cell frame setup completed');
  
  // Стили ячейки
  cell.fills = [{ type: 'SOLID', color: { r: 20/255, g: 20/255, b: 21/255 } }];
  
  // Добавляем правую границу
  cell.strokes = [{
    type: 'SOLID',
    color: { r: 163/255, g: 171/255, b: 187/255 },
    opacity: 0.12
  }];
  cell.strokeWeight = 1;
  cell.strokeAlign = 'INSIDE';
  
  // Для цветовых переменных добавляем цветной кружок
  console.log('🎨 === COLOR CIRCLE CREATION LOGIC ===');
  console.log('🎨 Variable type:', type);
  console.log('🎨 Type is COLOR:', type === 'COLOR');
  console.log('🎨 colorValue passed:', colorValue);
  console.log('🎨 colorValue type:', typeof colorValue);
  console.log('🎨 colorValue JSON:', JSON.stringify(colorValue, null, 2));
  console.log('🎨 value type:', typeof value);
  console.log('🎨 value content:', value);
  console.log('🎨 value JSON:', JSON.stringify(value, null, 2));
  
  // Определяем цвет для кружка
  let colorForCircle: { r: number; g: number; b: number; a?: number } | null = null;
  
  if (type === 'COLOR') {
    console.log('🎨 Variable is COLOR type, determining color source...');
    
    // Приоритет: сначала проверяем colorValue (разрешенный цвет)
    if (colorValue && typeof colorValue === 'object' && 'r' in colorValue) {
      console.log('🎨 ✅ Using resolved colorValue for circle');
      colorForCircle = colorValue;
    }
    // Если colorValue нет, но value содержит цвет напрямую
    else if (typeof value === 'object' && value && 'r' in value) {
      console.log('🎨 ✅ Using direct color value for circle');
      colorForCircle = value as { r: number; g: number; b: number; a?: number };
    }
    else {
      console.log('🎨 ❌ No valid color found for COLOR variable');
      console.log('🎨 ❌ colorValue check failed:', !colorValue || typeof colorValue !== 'object' || !('r' in colorValue));
      console.log('🎨 ❌ value check failed:', !(typeof value === 'object' && value && 'r' in value));
    }
  } else {
    console.log('🎨 ⚪ Variable is not COLOR type, skipping circle creation');
  }
  
  console.log('🎨 Final color for circle:', colorForCircle);
  console.log('🎨 Will create circle:', !!colorForCircle);
  
  if (colorForCircle) {
    console.log('🎨 ✅ Creating color circle with color:', colorForCircle);
    const colorCircle = figma.createEllipse();
    colorCircle.resize(20, 20);
    
    // Используем opacity из цвета, если он есть
    const opacity = colorForCircle.a !== undefined ? colorForCircle.a : 1;
    console.log('🎨 Circle opacity:', opacity);
    
    colorCircle.fills = [{ 
      type: 'SOLID', 
      color: { r: colorForCircle.r, g: colorForCircle.g, b: colorForCircle.b },
      opacity: opacity
    }];
    colorCircle.strokes = [{
      type: 'SOLID',
      color: { r: 179/255, g: 182/255, b: 189/255 },
      opacity: 0.12
    }];
    colorCircle.strokeWeight = 1;
    
    cell.appendChild(colorCircle);
    console.log('🎨 ✅ Color circle created and added to cell');
  } else {
    console.log('🎨 ❌ No color circle created - colorForCircle is null');
  }
  
  console.log('🎨 === END COLOR CIRCLE CREATION ===');
  
  // Создаем текст значения
  console.log('Creating text node...');
  const textNode = figma.createText();
  let displayValue = '';
  
  // Форматируем значение в зависимости от типа
  console.log('Formatting value. Type:', typeof value, 'Variable type:', type);
  if (typeof value === 'string') {
    // Для строковых значений (включая alias цветов) показываем как есть
    displayValue = value;
  } else if (typeof value === 'number') {
    displayValue = formatNumber(value);
  } else if (typeof value === 'boolean') {
    displayValue = value ? 'true' : 'false';
  } else if (typeof value === 'object' && value && 'r' in value) {
    // Это прямое значение цвета - показываем цвет с учетом opacity
    displayValue = formatColor(value as { r: number; g: number; b: number; a?: number });
  } else {
    displayValue = String(value);
  }
  
  console.log('Display value formatted:', displayValue);
  
  // Загружаем шрифт перед использованием
  try {
    await figma.loadFontAsync({ family: "JetBrains Mono", style: "Medium" });
    textNode.fontName = { family: "JetBrains Mono", style: "Medium" };
  } catch (error) {
    try {
      await figma.loadFontAsync({ family: "Inter", style: "Medium" });
      textNode.fontName = { family: "Inter", style: "Medium" };
    } catch (error2) {
      // Используем системный шрифт как последний вариант
      await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
      textNode.fontName = { family: "Roboto", style: "Regular" };
    }
  }
  
  textNode.characters = displayValue;
  textNode.fontSize = 16;
  textNode.fills = [{ type: 'SOLID', color: { r: 154/255, g: 161/255, b: 177/255 } }];
  textNode.textAlignHorizontal = 'LEFT';
  textNode.textAlignVertical = 'CENTER';
  
  console.log('Adding text node to cell...');
  cell.appendChild(textNode);
  
  console.log('Value cell completed');
  return cell;
}
