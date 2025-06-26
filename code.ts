/**
 * Variables Sheet Plugin for Figma
 * Автоматически создает таблицу со всеми переменными из выбранной коллекции
 */

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// This shows the HTML page in "ui.html".
figma.showUI(__html__, { width: 400, height: 700 });

/**
 * Конфигурация размеров и отступов для таблицы
 */
const TABLE_CONFIG = {
  spacing: {
    section: 24,
    group: 16,
    cell: 1,
    item: 12
  },
  sizes: {
    cellHeight: 48,
    colorCircle: 20,
    columnWidth: {
      designToken: 480,
      devToken: 552,
      value: 560
    }
  },
  radius: {
    group: 16,
    header: 15
  }
} as const;

/**
 * Цветовая схема для таблицы
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
 * Конфигурация шрифтов
 */
const FONT_CONFIG = {
  primary: { family: "JetBrains Mono", style: "Medium" },
  secondary: { family: "Inter", style: "Medium" },
  fallback: { family: "Roboto", style: "Regular" },
  header: { family: "Roboto", style: "Medium" }
} as const;

/**
 * Структура данных переменной с информацией о значениях, типах и алиасах
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
 * Информация о режиме/теме коллекции переменных
 */
interface ModeInfo {
  modeId: string;
  name: string;
}

/**
 * Информация о группе переменных (по префиксу)
 */
interface GroupInfo {
  prefix: string;
  count: number;
}

/**
 * Конфигурация стилей для групп
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
 * Утилитарная функция для создания стилей групп
 * @returns Конфигурация стилей для групп переменных
 */
function createGroupStyles(): GroupStyleConfig {
  return {
    cornerRadius: TABLE_CONFIG.radius.group,
    strokeColor: TABLE_COLORS.group.stroke,
    strokeOpacity: 0.3,
    strokeWeight: 1,
    fillColor: TABLE_COLORS.group.background,
    fillOpacity: 0.03
  };
}

/**
 * Применяет стили группы к фрейму
 * @param frame - Фрейм для применения стилей
 * @param styles - Конфигурация стилей
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
 * Создает базовый fill объект для заданного цвета
 * @param color - Цвет fill
 * @param opacity - Опциональная прозрачность
 * @returns Fill объект
 */
function createSolidFill(color: { r: number; g: number; b: number }, opacity?: number): SolidPaint {
  return {
    type: 'SOLID',
    color,
    ...(opacity !== undefined && { opacity })
  };
}

/**
 * Загружает шрифт с fallback цепочкой
 * @param type - Тип шрифта (primary, secondary, header, fallback)
 * @returns Promise<FontName> Загруженный шрифт
 */
async function loadFontWithFallback(type: 'primary' | 'secondary' | 'header' | 'fallback' = 'primary'): Promise<FontName> {
  const fontOrder = type === 'header' ? 
    [FONT_CONFIG.header, FONT_CONFIG.fallback] :
    type === 'secondary' ?
    [FONT_CONFIG.secondary, FONT_CONFIG.fallback] :
    [FONT_CONFIG.primary, FONT_CONFIG.secondary, FONT_CONFIG.fallback];

  for (const font of fontOrder) {
    try {
      await figma.loadFontAsync(font);
      return font;
    } catch (error) {
      // Продолжаем к следующему шрифту
      continue;
    }
  }
  
  // Возвращаем последний fallback, если ничего не загрузилось
  return FONT_CONFIG.fallback;
}

/**
 * Создает базовый фрейм с общими настройками для ячеек
 * @param name - Название фрейма
 * @param width - Ширина фрейма
 * @param layoutMode - Режим layout ('HORIZONTAL' или 'VERTICAL')
 * @returns Настроенный FrameNode
 */
function createBaseCell(name: string, width: number, layoutMode: 'HORIZONTAL' | 'VERTICAL' = 'VERTICAL'): FrameNode {
  const cell = figma.createFrame();
  cell.name = name;
  cell.layoutMode = layoutMode;
  cell.primaryAxisSizingMode = 'FIXED';
  cell.counterAxisSizingMode = 'AUTO';
  cell.resize(width, TABLE_CONFIG.sizes.cellHeight);
  cell.paddingLeft = 16;
  cell.paddingRight = 16;
  cell.paddingTop = 12;
  cell.paddingBottom = 12;
  cell.itemSpacing = layoutMode === 'HORIZONTAL' ? TABLE_CONFIG.spacing.item : 0;
  cell.fills = []; // Прозрачный фон по умолчанию
  
  return cell;
}

/**
 * Обработчик сообщений от UI
 * Маршрутизирует запросы на соответствующие функции
 */
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
    figma.ui.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
};

/**
 * Загружает все коллекции переменных и отправляет их в UI
 * Подсчитывает количество переменных в каждой коллекции
 */
async function loadCollections(): Promise<void> {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const allVariables = await figma.variables.getLocalVariablesAsync();
    
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
 * Группирует переменные по префиксам (часть до первого слеша)
 * @param collectionId - ID коллекции для группировки переменных
 */
async function loadGroups(collectionId: string): Promise<void> {
  try {
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
    
    // Преобразуем в массив и сортируем по алфавиту
    const groups: GroupInfo[] = Array.from(groupsMap.entries())
      .map(([prefix, count]) => ({ prefix, count }))
      .sort((a, b) => a.prefix.localeCompare(b.prefix, 'en', { sensitivity: 'base' }));
    
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
 * Основная функция создания таблицы с группировкой и сортировкой
 * @param collectionId - ID коллекции переменных
 * @param collectionName - Название коллекции
 * @param modes - Выбранные режимы/темы
 * @param groups - Выбранные группы переменных
 */
async function createVariablesTable(collectionId: string, collectionName: string, modes: ModeInfo[], groups: GroupInfo[]): Promise<void> {
  try {
    // Получаем коллекцию
    const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (!collection) {
      throw new Error('Collection not found');
    }

    // Получаем все переменные из коллекции
    const allVariables = await figma.variables.getLocalVariablesAsync();
    const collectionVariables = allVariables.filter(variable => 
      variable.variableCollectionId === collectionId
    );

    // Фильтруем переменные по выбранным группам
    const selectedPrefixes = groups.map(g => g.prefix);
    const filteredVariables = collectionVariables.filter(variable => {
      const prefix = variable.name.split('/')[0] || 'other';
      return selectedPrefixes.includes(prefix);
    });

    if (filteredVariables.length === 0) {
      throw new Error('No variables found in selected groups');
    }

    // Подготавливаем данные переменных
    const variablesData: VariableData[] = await Promise.all(
      filteredVariables.map(async (variable) => {
        const values: { [modeId: string]: string | number | boolean | { r: number; g: number; b: number; a?: number } } = {};
        const colorValues: { [modeId: string]: { r: number; g: number; b: number; a?: number } | null } = {};
        const aliasVariables: { [modeId: string]: Variable | null } = {};
        
        // Получаем значения для каждой темы
        for (const mode of modes) {
          const rawValue = variable.valuesByMode[mode.modeId];
          
          // Резолвим значение для отображения
          values[mode.modeId] = await resolveVariableValue(variable, mode.modeId, rawValue);
          
          // Для цветовых переменных также получаем фактический цвет
          if (variable.resolvedType === 'COLOR') {
            const resolvedColor = await resolveColorValue(variable, mode.modeId, rawValue);
            colorValues[mode.modeId] = resolvedColor;
            
            // Проверяем, является ли это алиасом и сохраняем ссылку на переменную-алиас
            if (typeof rawValue === 'object' && rawValue !== null && 'type' in rawValue && rawValue.type === 'VARIABLE_ALIAS' && 'id' in rawValue) {
              try {
                const referencedVariable = await figma.variables.getVariableByIdAsync(rawValue.id as string);
                aliasVariables[mode.modeId] = referencedVariable || null;
              } catch (error) {
                aliasVariables[mode.modeId] = null;
              }
            } else {
              // Не алиас - используем саму переменную
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
      })
    );

    // Сортируем переменные по префиксам, а затем по алфавиту внутри групп
    const sortedVariablesData = variablesData.sort((a, b) => {
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
 * Форматирует название переменной, заменяя слэши на дефисы
 * @param variableName - Исходное название переменной
 * @returns Отформатированное название
 */
function formatVariableName(variableName: string): string {
  return variableName.replace(/\//g, '-');
}

/**
 * Генерирует dev token из названия переменной в формате CSS custom property
 * @param variableName - Исходное название переменной
 * @returns CSS custom property в формате var(--variable-name)
 */
function generateDevToken(variableName: string): string {
  const cleanName = variableName
    .toLowerCase()
    .replace(/\//g, '-')        // Заменяем слеши на дефисы
    .replace(/\s+/g, '-')       // Заменяем пробелы на дефисы
    .replace(/[^a-z0-9\-_]/g, ''); // Удаляем все остальные специальные символы
  
  return `var(--${cleanName})`;
}

/**
 * Форматирует цвет для красивого отображения в HEX формате
 * @param color - Объект цвета с компонентами r, g, b и опциональным a
 * @returns Строка в формате HEX с процентами прозрачности при необходимости
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
  
  return hexColor;
}

/**
 * Форматирует число для красивого отображения, убирая лишние нули
 * @param num - Число для форматирования
 * @returns Строковое представление числа без лишних десятичных знаков
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
 * Обрабатывает алиасы, цвета и примитивные типы
 * @param variable - Переменная Figma
 * @param modeId - ID режима
 * @param value - Сырое значение переменной
 * @returns Разрешенное значение для отображения
 */
async function resolveVariableValue(variable: Variable, modeId: string, value: unknown): Promise<string | number | boolean | { r: number; g: number; b: number; a?: number }> {
  if (value === undefined || value === null) {
    return '';
  }

  // Проверяем на VARIABLE_ALIAS
  if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS' && 'id' in value) {
    try {
      const referencedVariable = await figma.variables.getVariableByIdAsync(value.id as string);
      if (referencedVariable) {
        // Для alias переменных возвращаем имя референсной переменной с форматированием
        return formatVariableName(referencedVariable.name);
      } else {
        return 'Unknown variable';
      }
    } catch (error) {
      return 'Error resolving alias';
    }
  }

  // Для прямых значений
  if (typeof value === 'object' && value !== null && 'r' in value) {
    // Это цветовое значение - возвращаем как есть для дальнейшей обработки
    return value as { r: number; g: number; b: number; a?: number };
  }

  // Для остальных типов возвращаем как есть
  return value as string | number | boolean;
}

/**
 * Резолвит цветовое значение переменной, включая alias (рекурсивно)
 * @param variable - Переменная Figma
 * @param modeId - ID режима
 * @param value - Сырое значение переменной
 * @returns Разрешенное цветовое значение или null если не удалось разрешить
 */
async function resolveColorValue(variable: Variable, modeId: string, value: unknown): Promise<{ r: number; g: number; b: number; a?: number } | null> {
  // Проверяем на undefined и null
  if (value === undefined || value === null) {
    return null;
  }

  // Если это alias (ссылка на другую переменную)
  if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS' && 'id' in value) {
    try {
      const referencedVariable = await figma.variables.getVariableByIdAsync(value.id as string);
      
      if (referencedVariable && referencedVariable.resolvedType === 'COLOR') {
        // Сначала пробуем тот же режим
        let refValue = referencedVariable.valuesByMode[modeId];
        
        // Если в том же режиме нет значения, пробуем первый доступный режим
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

  // Если это строка, которая может быть именем переменной (для случаев, когда resolveVariableValue уже разрешил alias)
  if (typeof value === 'string' && value.includes('/')) {
    try {
      // Получаем все переменные и ищем по имени
      const allVariables = await figma.variables.getLocalVariablesAsync();
      const foundVariable = allVariables.find(v => v.name === value && v.resolvedType === 'COLOR');
      
      if (foundVariable) {
        const foundValue = foundVariable.valuesByMode[modeId];
        if (foundValue !== undefined) {
          return await resolveColorValue(foundVariable, modeId, foundValue);
        } else {
          // Пробуем первый доступный режим
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

  // Для прямых цветовых значений
  if (typeof value === 'object' && value !== null && 'r' in value && 'g' in value && 'b' in value) {
    const colorResult = value as { r: number; g: number; b: number; a?: number };
    return colorResult;
  }
  
  return null;
}

/**
 * Создает таблицу с переменными, разделенными по группам с повторяющимися заголовками
 * Основная функция компоновки всей таблицы с группировкой по префиксам и темам
 * @param variablesData - Массив данных переменных
 * @param modes - Массив режимов/тем
 */
async function createTableFrame(variablesData: VariableData[], modes: ModeInfo[]): Promise<void> {
  // Создаем основной фрейм для таблицы
  const tableFrame = figma.createFrame();
  tableFrame.name = 'Variables Table';
  tableFrame.layoutMode = 'HORIZONTAL';
  tableFrame.primaryAxisSizingMode = 'AUTO';
  tableFrame.counterAxisSizingMode = 'AUTO';
  tableFrame.itemSpacing = TABLE_CONFIG.spacing.section;
  
  // Стили для таблицы
  tableFrame.cornerRadius = 0;
  tableFrame.fills = [];
  
  // Группируем переменные по префиксам
  const groupedVariables = new Map<string, VariableData[]>();
  
  variablesData.forEach(variable => {
    const prefix = variable.name.split('/')[0] || 'other';
    if (!groupedVariables.has(prefix)) {
      groupedVariables.set(prefix, []);
    }
    groupedVariables.get(prefix)!.push(variable);
  });
  
  // === 1. СОЗДАЕМ ОСНОВНУЮ ТАБЛИЦУ С ПЕРЕМЕННЫМИ ===
  const mainTableFrame = figma.createFrame();
  mainTableFrame.name = 'Main Table';
  mainTableFrame.layoutMode = 'VERTICAL';
  mainTableFrame.primaryAxisSizingMode = 'AUTO';
  mainTableFrame.counterAxisSizingMode = 'AUTO';
  mainTableFrame.itemSpacing = TABLE_CONFIG.spacing.group;
  mainTableFrame.fills = [];
  mainTableFrame.strokes = [];
  
  // Создаем группы с заголовками
  for (const [prefix, variables] of groupedVariables) {
    // Создаем фрейм для группы
    const groupFrame = figma.createFrame();
    groupFrame.name = `Group: ${prefix}`;
    groupFrame.layoutMode = 'VERTICAL';
    groupFrame.primaryAxisSizingMode = 'AUTO';
    groupFrame.counterAxisSizingMode = 'AUTO';
    groupFrame.itemSpacing = TABLE_CONFIG.spacing.cell;
    groupFrame.paddingTop = 0;
    groupFrame.paddingBottom = 0;
    groupFrame.paddingLeft = 0;
    groupFrame.paddingRight = 0;
    
    // Стили для группы
    applyGroupStyles(groupFrame, createGroupStyles());
    
    // Создаем заголовок для группы (только Design Token и Dev Token)
    const headerRow = await createMainHeaderRow();
    groupFrame.appendChild(headerRow);
    
    // Создаем строки данных для переменных этой группы (без столбцов тем)
    for (let i = 0; i < variables.length; i++) {
      try {
        const dataRow = await createMainDataRow(variables[i], i === variables.length - 1);
        groupFrame.appendChild(dataRow);
      } catch (error) {
        // Пропускаем проблемные строки, но продолжаем создание таблицы
        continue;
      }
    }
    
    // Добавляем группу в основную таблицу
    mainTableFrame.appendChild(groupFrame);
  }
  
  // Добавляем основную таблицу в общий фрейм
  tableFrame.appendChild(mainTableFrame);
  
  // === 2. СОЗДАЕМ ГРУППЫ ДЛЯ КАЖДОЙ ТЕМЫ ===
  for (let modeIndex = 0; modeIndex < modes.length; modeIndex++) {
    const mode = modes[modeIndex];
    
    // Создаем фрейм для темы
    const themeFrame = figma.createFrame();
    themeFrame.name = `Theme: ${mode.name}`;
    themeFrame.layoutMode = 'VERTICAL';
    themeFrame.primaryAxisSizingMode = 'AUTO';
    themeFrame.counterAxisSizingMode = 'AUTO';
    themeFrame.itemSpacing = TABLE_CONFIG.spacing.group;
    themeFrame.fills = [];
    themeFrame.strokes = [];
    
    // Создаем группы для каждого префикса в рамках темы
    for (const [prefix, variables] of groupedVariables) {
      // Создаем фрейм для группы переменных этой темы
      const themeGroupFrame = figma.createFrame();
      themeGroupFrame.name = `${mode.name} - ${prefix}`;
      themeGroupFrame.layoutMode = 'VERTICAL';
      themeGroupFrame.primaryAxisSizingMode = 'AUTO';
      themeGroupFrame.counterAxisSizingMode = 'AUTO';
      themeGroupFrame.itemSpacing = TABLE_CONFIG.spacing.cell;
      themeGroupFrame.paddingTop = 0;
      themeGroupFrame.paddingBottom = 0;
      themeGroupFrame.paddingLeft = 0;
      themeGroupFrame.paddingRight = 0;
      
      // Стили для группы темы
      applyGroupStyles(themeGroupFrame, createGroupStyles());
      
      // Создаем заголовок для группы темы
      const themeHeaderRow = await createThemeHeaderRow(mode.name);
      themeGroupFrame.appendChild(themeHeaderRow);
      
      // Создаем ячейки значений для переменных этой группы и темы
      for (let i = 0; i < variables.length; i++) {
        const variable = variables[i];
        const value = variable.values[mode.modeId];
        const colorValue = variable.colorValues?.[mode.modeId];
        const aliasVariable = variable.aliasVariables?.[mode.modeId];
        
        try {
          const valueCell = await createValueCell(value, variable.variableType, TABLE_CONFIG.sizes.columnWidth.value, colorValue, aliasVariable);
          valueCell.name = `${variable.name} - ${mode.name}`;
          
          // Оборачиваем ячейку в контейнер для правильного отступа
          const valueContainer = figma.createFrame();
          valueContainer.name = `Value: ${variable.name}`;
          valueContainer.layoutMode = 'HORIZONTAL';
          valueContainer.primaryAxisSizingMode = 'AUTO';
          valueContainer.counterAxisSizingMode = 'AUTO';
          valueContainer.itemSpacing = 0;
          valueContainer.fills = [createSolidFill(TABLE_COLORS.dataRow.background)];
          
          // Закругляем углы для последней строки
          if (i === variables.length - 1) {
            valueContainer.bottomLeftRadius = TABLE_CONFIG.radius.header;
            valueContainer.bottomRightRadius = TABLE_CONFIG.radius.header;
          }
          
          valueContainer.appendChild(valueCell);
          themeGroupFrame.appendChild(valueContainer);
        } catch (error) {
          // Пропускаем проблемные ячейки, но продолжаем создание таблицы
          continue;
        }
      }
      
      // Добавляем группу темы в фрейм темы
      themeFrame.appendChild(themeGroupFrame);
    }
    
    // Добавляем фрейм темы в общий фрейм
    tableFrame.appendChild(themeFrame);
  }
  
  // Размещаем таблицу в текущей видимой области (где пользователь приближен)
  figma.currentPage.appendChild(tableFrame);
  
  // Размещаем таблицу в области просмотра пользователя
  const bounds = tableFrame.absoluteBoundingBox;
  if (bounds) {
    // Размещаем таблицу в левом верхнем углу текущей видимой области с небольшим отступом
    tableFrame.x = figma.viewport.center.x - figma.viewport.bounds.width / 2 + 50;
    tableFrame.y = figma.viewport.center.y - figma.viewport.bounds.height / 2 + 50;
  }
  
  // Выбираем таблицу
  figma.currentPage.selection = [tableFrame];
  figma.viewport.scrollAndZoomIntoView([tableFrame]);
}

/**
 * Создает строку заголовка основной таблицы (только Design Token и Dev Token)
 * @returns FrameNode с ячейками заголовков
 */
async function createMainHeaderRow(): Promise<FrameNode> {
  const headerRow = figma.createFrame();
  headerRow.name = 'Main Header Row';
  headerRow.layoutMode = 'HORIZONTAL';
  headerRow.primaryAxisSizingMode = 'AUTO';
  headerRow.counterAxisSizingMode = 'AUTO';
  headerRow.itemSpacing = 0;
  
  // Стили заголовка
  headerRow.fills = [createSolidFill(TABLE_COLORS.header.background)];
  
  // Закругляем только верхние углы заголовка
  headerRow.topLeftRadius = TABLE_CONFIG.radius.header;
  headerRow.topRightRadius = TABLE_CONFIG.radius.header;
  headerRow.bottomLeftRadius = 0;
  headerRow.bottomRightRadius = 0;
  
  // Design Token колонка
  const designTokenHeader = await createHeaderCell('Design Token', TABLE_CONFIG.sizes.columnWidth.designToken);
  headerRow.appendChild(designTokenHeader);
  
  // Dev Token колонка
  const devTokenHeader = await createHeaderCell('Dev Token', TABLE_CONFIG.sizes.columnWidth.devToken);
  headerRow.appendChild(devTokenHeader);
  
  return headerRow;
}

/**
 * Создает строку заголовка для темы
 * @param themeName - Название темы
 * @returns FrameNode с заголовком темы
 */
async function createThemeHeaderRow(themeName: string): Promise<FrameNode> {
  const headerRow = figma.createFrame();
  headerRow.name = `Theme Header: ${themeName}`;
  headerRow.layoutMode = 'HORIZONTAL';
  headerRow.primaryAxisSizingMode = 'AUTO';
  headerRow.counterAxisSizingMode = 'AUTO';
  headerRow.itemSpacing = 0;
  
  // Стили заголовка
  headerRow.fills = [createSolidFill(TABLE_COLORS.header.background)];
  
  // Закругляем только верхние углы заголовка
  headerRow.topLeftRadius = TABLE_CONFIG.radius.header;
  headerRow.topRightRadius = TABLE_CONFIG.radius.header;
  headerRow.bottomLeftRadius = 0;
  headerRow.bottomRightRadius = 0;
  
  // Создаем заголовок темы
  const themeHeader = await createHeaderCell(themeName, TABLE_CONFIG.sizes.columnWidth.value);
  headerRow.appendChild(themeHeader);
  
  return headerRow;
}

/**
 * Создает строку данных основной таблицы (без столбцов тем)
 * @param variableData - Данные переменной
 * @param isLast - Является ли строка последней в группе
 * @returns FrameNode со строкой данных
 */
async function createMainDataRow(variableData: VariableData, isLast: boolean): Promise<FrameNode> {
  const dataRow = figma.createFrame();
  dataRow.name = `Main Data Row: ${variableData.name}`;
  dataRow.layoutMode = 'HORIZONTAL';
  dataRow.primaryAxisSizingMode = 'AUTO';
  dataRow.counterAxisSizingMode = 'AUTO';
  dataRow.itemSpacing = 0;
  
  // Стили строки данных
  dataRow.fills = [createSolidFill(TABLE_COLORS.dataRow.background)];
  
  // Закругляем только нижние углы для последней строки
  if (isLast) {
    dataRow.topLeftRadius = 0;
    dataRow.topRightRadius = 0;
    dataRow.bottomLeftRadius = TABLE_CONFIG.radius.header;
    dataRow.bottomRightRadius = TABLE_CONFIG.radius.header;
  } else {
    // Средние строки без закруглений
    dataRow.cornerRadius = 0;
  }
  
  // Design Token ячейка
  const designTokenCell = await createDataCell(formatVariableName(variableData.name), TABLE_CONFIG.sizes.columnWidth.designToken, 'design-token');
  dataRow.appendChild(designTokenCell);
  
  // Dev Token ячейка
  const devTokenCell = await createDataCell(variableData.devToken, TABLE_CONFIG.sizes.columnWidth.devToken, 'dev-token');
  dataRow.appendChild(devTokenCell);
  
  return dataRow;
}

/**
 * Создает ячейку данных для основной таблицы
 * @param text - Текст для отображения в ячейке
 * @param width - Ширина ячейки
 * @param type - Тип ячейки (design-token или dev-token)
 * @returns FrameNode с ячейкой данных
 */
async function createDataCell(text: string, width: number, type: 'design-token' | 'dev-token'): Promise<FrameNode> {
  const cell = createBaseCell(`Data Cell: ${type}`, width, 'VERTICAL');
  
  // Настраиваем выравнивание контента
  cell.primaryAxisAlignItems = 'CENTER'; // Центрирование по вертикали
  cell.counterAxisAlignItems = 'MIN'; // Выравнивание по левому краю
  
  // Создаем текст
  const textNode = figma.createText();
  
  // Выбираем шрифт в зависимости от типа ячейки
  const fontType = type === 'dev-token' ? 'primary' : 'secondary';
  textNode.fontName = await loadFontWithFallback(fontType);
  
  textNode.characters = text;
  textNode.fontSize = 16;
  textNode.fills = [createSolidFill(TABLE_COLORS.text.primary)];
  textNode.textAlignHorizontal = 'LEFT';
  textNode.textAlignVertical = 'CENTER';
  
  cell.appendChild(textNode);
  
  return cell;
}

/**
 * Создает ячейку значения переменной с цветным индикатором (если применимо)
 * @param value - Значение переменной для отображения
 * @param type - Тип переменной Figma
 * @param width - Ширина ячейки
 * @param colorValue - Разрешенное цветовое значение (опционально)
 * @param aliasVariable - Переменная алиас для привязки цвета (опционально)
 * @returns FrameNode с ячейкой значения
 */
async function createValueCell(value: string | number | boolean | { r: number; g: number; b: number; a?: number }, type: VariableResolvedDataType, width: number, colorValue?: { r: number; g: number; b: number; a?: number } | null, aliasVariable?: Variable | null): Promise<FrameNode> {
  const cell = createBaseCell('Value Cell', width, 'HORIZONTAL');
  
  // Настраиваем выравнивание контента
  cell.primaryAxisAlignItems = 'MIN'; // Выравнивание по левому краю (для горизонтального layout)
  cell.counterAxisAlignItems = 'CENTER'; // Центрирование по вертикали
  
  // Определяем цвет для кружка
  let colorForCircle: { r: number; g: number; b: number; a?: number } | null = null;
  
  if (type === 'COLOR') {
    // Приоритет: сначала проверяем colorValue (разрешенный цвет)
    if (colorValue && typeof colorValue === 'object' && 'r' in colorValue) {
      colorForCircle = colorValue;
    }
    // Если colorValue нет, но value содержит цвет напрямую
    else if (typeof value === 'object' && value && 'r' in value) {
      colorForCircle = value as { r: number; g: number; b: number; a?: number };
    }
  }
  
  // Создаем цветной кружок для цветовых переменных
  if (colorForCircle) {
    const colorCircle = figma.createEllipse();
    colorCircle.resize(TABLE_CONFIG.sizes.colorCircle, TABLE_CONFIG.sizes.colorCircle);
    
    // Проверяем, есть ли у нас алиас переменная для применения
    if (aliasVariable && type === 'COLOR') {
      try {
        // Создаем начальный SOLID fill
        const solidFill = createSolidFill(
          { r: colorForCircle.r, g: colorForCircle.g, b: colorForCircle.b },
          colorForCircle.a !== undefined ? colorForCircle.a : 1
        );
        
        // Применяем алиас переменной к fill
        const aliasedFill = figma.variables.setBoundVariableForPaint(solidFill, 'color', aliasVariable);
        colorCircle.fills = [aliasedFill];
      } catch (error) {
        // Fallback на обычный цвет
        colorCircle.fills = [createSolidFill(
          { r: colorForCircle.r, g: colorForCircle.g, b: colorForCircle.b },
          colorForCircle.a !== undefined ? colorForCircle.a : 1
        )];
      }
    } else {
      // Используем обычный цвет если нет алиаса
      colorCircle.fills = [createSolidFill(
        { r: colorForCircle.r, g: colorForCircle.g, b: colorForCircle.b },
        colorForCircle.a !== undefined ? colorForCircle.a : 1
      )];
    }
    
    colorCircle.strokes = [createSolidFill(TABLE_COLORS.colorCircle.stroke, 0.12)];
    colorCircle.strokeWeight = 1;
    
    cell.appendChild(colorCircle);
  }
  
  // Создаем текст значения
  let displayValue = '';
  
  // Форматируем значение в зависимости от типа
  if (typeof value === 'string') {
    // Для строковых значений проверяем, является ли это названием переменной
    if (value.includes('/')) {
      // Это название переменной - форматируем его
      displayValue = formatVariableName(value);
    } else {
      // Обычная строка - показываем как есть
      displayValue = value;
    }
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
  
  // Создаем текст
  const textNode = figma.createText();
  textNode.fontName = await loadFontWithFallback('primary');
  textNode.characters = displayValue;
  textNode.fontSize = 16;
  textNode.fills = [createSolidFill(TABLE_COLORS.text.primary)];
  textNode.textAlignHorizontal = 'LEFT';
  textNode.textAlignVertical = 'CENTER';
  
  cell.appendChild(textNode);
  
  return cell;
}

/**
 * Создает ячейку заголовка
 * @param text - Текст заголовка
 * @param width - Ширина ячейки
 * @returns FrameNode с ячейкой заголовка
 */
async function createHeaderCell(text: string, width: number): Promise<FrameNode> {
  const cell = createBaseCell(`Header: ${text}`, width, 'VERTICAL');
  
  // Настраиваем выравнивание контента
  cell.primaryAxisAlignItems = 'CENTER'; // Центрирование по вертикали
  cell.counterAxisAlignItems = 'MIN'; // Выравнивание по левому краю
  
  // Создаем текст
  const textNode = figma.createText();
  textNode.fontName = await loadFontWithFallback('header');
  textNode.characters = text;
  textNode.fontSize = 16;
  textNode.fills = [createSolidFill(TABLE_COLORS.text.primary)];
  textNode.textAlignHorizontal = 'LEFT';
  textNode.textAlignVertical = 'CENTER';
  
  cell.appendChild(textNode);
  
  return cell;
}
