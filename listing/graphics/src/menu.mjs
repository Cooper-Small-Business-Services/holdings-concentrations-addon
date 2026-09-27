/**
 * The menu of the add-on as the screenshots show it. Change the menu here
 * alone: the menu screenshot reads this file.
 *
 * The spreadsheet puts the menu of an add-on under the Extensions menu.
 * `parent` is that menu. `before` lists the items of the parent menu above
 * the add-on. `title` is the name of the add-on in the parent menu. `items`
 * lists the items of the add-on menu in order, and `highlight` names the item
 * under the pointer.
 */
export const MENU = {
  parent: "Extensions",
  before: ["Add-ons", "Macros"],
  title: "Holdings Concentration for Tiller",
  items: ["Refresh", "Set API key"],
  highlight: "Refresh",
};

/**
 * The menus of the menu bar of the spreadsheet.
 */
export const EDITOR_MENUS = ["File", "Edit", "View", "Insert", "Format", "Data", "Tools", "Extensions", "Help"];

/**
 * The tabs that the tab bar shows. The script hides its second tab, so the
 * bar does not show it.
 */
export const TABS = ["Holdings", "Concentration"];
