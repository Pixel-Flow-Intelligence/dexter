export type RemoteMode = 'ssh' | 'http';

export interface RemoteConfigCommand {
  action: 'set-url' | 'set-token' | 'show' | 'clear-token';
  value?: string;
}

export interface RemoteArgs {
  mode: RemoteMode;
  query?: string;
  configCommand?: RemoteConfigCommand;
}

export function parseRemoteArgs(args: string[]): RemoteArgs {
  let mode: RemoteMode = 'ssh';
  let query: string | undefined;
  let configCommand: RemoteConfigCommand | undefined;
  let index = 0;

  if (args[0] === 'http' || args[0] === 'ssh') {
    mode = args[0];
    index += 1;
  } else if (args[0] === '--sse') {
    mode = 'http';
    index += 1;
    if (args[index] === 'http') index += 1;
  }

  if (args[index] === 'config') {
    const action = args[index + 1];
    if (action !== 'set-url' && action !== 'set-token' && action !== 'show' && action !== 'clear-token') {
      throw new Error('config action must be set-url, set-token, show, or clear-token');
    }
    configCommand = { action, value: args[index + 2] };
    if (args.length > index + 3) throw new Error('too many config arguments');
    return { mode, query, configCommand };
  }

  while (index < args.length) {
    const arg = args[index];
    if (arg === '--query') {
      query = args[index + 1];
      if (!query) throw new Error('--query requires a value');
      index += 2;
      continue;
    }
    throw new Error(`unknown remote argument: ${arg}`);
  }

  return { mode, query, configCommand };
}
