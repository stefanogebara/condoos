import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ClineContext {
  files: string[];
  content: string;
}

interface Context7File {
  path: string;
  content: string;
  language: string;
}

async function gatherContext(): Promise<ClineContext> {
  const config = JSON.parse(readFileSync('cline.config.json', 'utf-8'));
  const files: string[] = [];
  const content: string[] = [];

  // Gather all files based on include patterns
  for (const pattern of config.context.include) {
    const { stdout } = await execAsync(`find . -type f -path "${pattern}"`);
    const matchedFiles = stdout.split('\n').filter(Boolean);
    files.push(...matchedFiles);
  }

  // Read content of each file
  for (const file of files) {
    try {
      const fileContent = readFileSync(file, 'utf-8');
      content.push(`=== ${file} ===\n${fileContent}\n`);
    } catch (error) {
      console.error(`Error reading file ${file}:`, error);
    }
  }

  return {
    files,
    content: content.join('\n')
  };
}

function getFileLanguage(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'json': 'json',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'md': 'markdown',
    'sql': 'sql',
    'env': 'plaintext'
  };
  return languageMap[extension] || 'plaintext';
}

async function createContext7Files(): Promise<Context7File[]> {
  const config = JSON.parse(readFileSync('cline.config.json', 'utf-8'));
  const context7Files: Context7File[] = [];

  // Gather all files based on include patterns
  for (const pattern of config.context.include) {
    const { stdout } = await execAsync(`find . -type f -path "${pattern}"`);
    const matchedFiles = stdout.split('\n').filter(Boolean);
    
    for (const file of matchedFiles) {
      try {
        const fileContent = readFileSync(file, 'utf-8');
        context7Files.push({
          path: file,
          content: fileContent,
          language: getFileLanguage(file)
        });
      } catch (error) {
        console.error(`Error reading file ${file}:`, error);
      }
    }
  }

  return context7Files;
}

async function createClinePrompt(task: string): Promise<string> {
  const context7Files = await createContext7Files();
  
  // Create Context7 format
  const context7Content = context7Files.map(file => 
    `\`\`\`${file.language}:${file.path}\n${file.content}\n\`\`\``
  ).join('\n\n');
  
  return `
Task: ${task}

Context7:
${context7Content}

Please provide a detailed plan for implementing this task, including:
1. Required changes to existing files
2. New files to be created
3. Dependencies to be added
4. Testing requirements
5. Implementation steps
`;
}

async function main() {
  const task = process.argv[2];
  if (!task) {
    console.error('Please provide a task description');
    process.exit(1);
  }

  const prompt = await createClinePrompt(task);
  console.log('Cline Prompt with Context7:');
  console.log(prompt);
}

main().catch(console.error); 