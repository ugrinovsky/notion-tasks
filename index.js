import {Client} from '@notionhq/client';
import { readFile } from 'fs/promises';
const tasks = JSON.parse(await readFile(new URL('./tasks.json', import.meta.url)));

const notion = new Client ({
  auth: ''
});

const databaseId = '';
const userDatabaseId = '';

async function getTasksFromNotionDatabase () {
  const pages = [];
  let cursor = undefined;

  while (true) {
    const {results, next_cursor} = await notion.databases
      .query ({
        database_id: databaseId,
        start_cursor: cursor,
      })
    pages.push (...results);
    if (!next_cursor) {
      break;
    }
    cursor = next_cursor;
  }
  return pages.map (page => {
    const props = page.properties;
    const id = props['ID'].title
      .map (({plain_text}) => plain_text)
      .join ('');
    return {
      page_id: page.id,
      id,
      link: props['Ссылка'].url,
      userID: props['Исполнитель'] && props['Исполнитель'].people && props['Исполнитель'].people.length ? props['Исполнитель'].people[0].id : null,
      mark: props['Веха'] && props['Веха'].select ? props['Веха'].select.name : null,
      taskDate: props['Срок задачи'] && props['Срок задачи'].date ? props['Срок задачи'].date.start : null,
      projectName: props['Проект'] && props['Проект'].select ? props['Проект'].select.name : null,
      projectDate: props['Срок проекта'] && props['Срок проекта'].date ? props['Срок проекта'].date.start : null,
      author: props['Автор'] && props['Автор'].select ? props['Автор'].select.name : null
    };
  });
}

async function retrieveTable() {
  const result = await notion.databases.retrieve({
    database_id: databaseId
  }).catch(error => {
    printError ('retrieveTable', {}, error);
  });
  return result;
}

async function getUsers2() {
  const users = [];
  let cursor = undefined;

  while (true) {
    const {results, next_cursor} = await notion.databases
      .query ({
        database_id: userDatabaseId,
        start_cursor: cursor,
      })
    users.push (...results);
    if (!next_cursor) {
      break;
    }
    cursor = next_cursor;
  }
  return users.map (user => {
    return {
      fio: user.properties['ФИО'].title[0].plain_text,
      id: user.properties['user'].people[0].id
    }
  });
}

if (tasks.length) {
  getTasksFromNotionDatabase ()
    .then (async currentTasks => {
      const promises = [];

      const currentIDs = currentTasks.map (task => task.id);
      const IDs = tasks.map (task => task.id);
      const completedTasks = currentIDs.filter (x => !IDs.includes (x));

      const users = await getUsers2 ();

      tasks.forEach (item => {
        promises.push (resolveTask (item, currentTasks, users));
      });

      console.log (completedTasks);
      completedTasks.forEach (item => {
        console.log (item);
        promises.push (archiveTask (item, currentTasks));
      });

      Promise.all (promises).then (() => {
        console.log ('finish');
      });
    })
    .catch (err => {
      printError ('getTaskFromNotion', {}, err);
    });
} else {
  console.log('Список задач из tasks.json пустой!');
}

function resolveTask (item, currentTasks, users) {
  try {
    const currentTask = currentTasks.find (currentTask => {
      return currentTask.id === item.id;
    });
    const user = users.find(user => {
      return user.fio === item.user;
    });
    if (user) {
      item.userID = user.id;
    }

    if (!currentTask) {
      return addTask (item);
    } else {
      return updateTask (item, currentTask);
    }
  } catch (error) {
    printError ('resolveTask', item, error);
  }
}

function addTask (item) {
  const properties = createProperties (item, true);
  try {
    return notion.pages
    .create ({
      parent: {database_id: databaseId},
      properties: properties,
    })
  } catch (error) {
    printError ('addTask', item, err);
    return addTask(item, true);
  }
}

function archiveTask(completedTask, currentTasks) {
  const currentTask = currentTasks.find (task => {
    return task.id === completedTask;
  });

  if (currentTask) {
    return notion.pages
      .update ({
        page_id: currentTask.page_id,
        // properties: {
        //   Выполнено: createPropertyByType('checkbox', true)
        // }
        // FIXME: сейчас архивирование не работает
        archived: true
      })
      .catch (err => {
        printError ('archiveTask', currentTask, err);
      });
  }
}

function updateTask (item, currentTask) {
  const pageId = currentTask.page_id;

  if (pageId) {
    const properties = createProperties (item, false, currentTask);

    return notion.pages
      .update ({
        page_id: pageId,
        properties: properties
      })
      .catch (err => {
        printError ('updateTask', item, err);
      });
  }
}

function createProperties (item, isNew, currentTask = {}) {
  const properties = {
    Описание: createPropertyByType('rich_text', item.description),
  };

  if (isNew) {
    properties.ID = createPropertyByType('title', item.id);
    properties.Ссылка = createPropertyByType('url', item.link);
  }

  if (item.userID) {
    properties.Исполнитель = createPropertyByType('people', item.userID);
  }

  if (item.mark) {
    properties.Веха = createPropertyByType('select', item.mark);
  }

  if (item.taskDate) {
    properties['Срок задачи'] = createPropertyByType('date', item.taskDate);
  }
  if (item.projectName) {
    properties.Проект = createPropertyByType('select', item.projectName, 40);
  }

  if (item.projectDate) {
    properties['Срок проекта'] = createPropertyByType('date', item.projectDate);
  }

  if (item.author) {
    properties['Автор'] = createPropertyByType('select', item.author);
  }
  // console.log(item, properties)
  return properties;
}

function createPropertyByType(type, value = '', textLength = 2000) {
  let result = {};
  switch (type) {
    case 'select':
      result = {
        select: {
          name: value.slice(0, textLength),
        }
      };
      break;
    case 'rich_text':
      result = {
        rich_text: [
          {
            text: {
              content: value.slice(0, textLength),
            },
          },
        ],
      };
      break;
    case 'title':
      result = {
        title: [
          {
            text: {
              content: value,
            },
          },
        ],
      };
      break;
    case 'date':
      result = {
        date: {
          start: new Date (value).toISOString(),
        },
      }
      break;
    case 'checkbox':
      result = {
        checkbox: value
      }
      break;
    case 'people':
      result = {
        people: [{
          object: 'user',
          id: value
        }]
      };
      break;
    case 'url':
      result = {
        url: value
      };
      break;
    default:
      break;
  }
  return result;
}

function printError(type, item, error) {
  console.log ('======================================');
  console.log ('Type: ' + type);
  console.log ('Item: ', item);
  console.error (error);
  console.log ('======================================');
}