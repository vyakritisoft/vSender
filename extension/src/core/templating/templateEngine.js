/**
 * Template Engine
 * 
 * Replaces {{variable}} placeholders in message templates.
 * Supports fallback/default values: {{variable|default_value}}
 */

/**
 * Render a template with variables
 * @param {string} template - Message template with {{variable}} placeholders
 * @param {Object} variables - Key-value map of variable values
 * @returns {string} Rendered message
 */
export function renderTemplate(template, variables = {}) {
  if (!template) return '';

  return template.replace(/\{\{(\w+)(?:\|([^}]*))?\}\}/g, (match, varName, fallback) => {
    const value = variables[varName];
    
    // Use the variable value if it exists and is not empty
    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }
    
    // Use fallback if provided
    if (fallback !== undefined) {
      return fallback;
    }

    // Return empty string if no value and no fallback
    return '';
  });
}

/**
 * Extract variable names from a template
 * @param {string} template - Message template
 * @returns {string[]} Array of variable names found
 */
export function extractVariables(template) {
  if (!template) return [];
  
  const regex = /\{\{(\w+)(?:\|[^}]*)?\}\}/g;
  const variables = new Set();
  let match;
  
  while ((match = regex.exec(template)) !== null) {
    variables.add(match[1]);
  }
  
  return [...variables];
}

/**
 * Validate that all required variables are present in the mapping
 * @param {string} template - Message template
 * @param {Object} fieldMapping - Field mapping from parser
 * @returns {Object} { valid, missingVariables, availableVariables }
 */
export function validateTemplate(template, fieldMapping) {
  const requiredVars = extractVariables(template);
  const availableVars = Object.keys(fieldMapping).filter(k => k !== 'phone');
  
  const missingVars = requiredVars.filter(v => !availableVars.includes(v));
  
  return {
    valid: missingVars.length === 0,
    missingVariables: missingVars,
    availableVariables: availableVars,
    requiredVariables: requiredVars
  };
}

/**
 * Preview a rendered template with sample data
 * @param {string} template - Message template
 * @param {Object} sampleData - Sample variable values
 * @returns {string} Rendered preview
 */
export function previewTemplate(template, sampleData = {}) {
  return renderTemplate(template, sampleData);
}
