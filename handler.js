const AWS = require("aws-sdk");
const dynamoDbClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
const STUDENTS_TABLE = process.env.STUDENTS_TABLE;
const USERPOOL_ID = process.env.USERPOOL_ID;

async function createUser({ username, email, password, group, departmentNO = null, classNo = null }) {
  var params = {
    UserPoolId: USERPOOL_ID,
    Username: username,
    TemporaryPassword: password,
    UserAttributes: [
      {
        Name: 'email',
        Value: email
      },
      {
        Name: 'email_verified',
        Value: "True"
      }
    ]
  };

  if (group == "student" && departmentNO && classNo) {
    params["UserAttributes"].push({
      Name: 'custom:departmentNo',
      Value: departmentNO
    })
    params["UserAttributes"].push({
      Name: 'custom:classNo',
      Value: classNo
    })
  }

  await cognitoidentityserviceprovider.adminCreateUser(params).promise();
  var params = {
    GroupName: group, /* required */
    UserPoolId: USERPOOL_ID, /* required */
    Username: username /* required */
  };
  await cognitoidentityserviceprovider.adminAddUserToGroup(params).promise();
}

async function updateStudent({ username, detail = null, departmentNo = null, classNo = null }) {
  if (departmentNo && classNo) {
    var params = {
      UserAttributes: [
        {
          Name: 'custom:departmentNo',
          Value: departmentNo
        },
        {
          Name: 'custom:classNo',
          Value: classNo
        }
      ],
      UserPoolId: USERPOOL_ID,
      Username: username
    }
    await cognitoidentityserviceprovider.adminUpdateUserAttributes(params).promise();
  }

  if (detail) {
    for (var key in detail) {
      var params = {
        TableName: STUDENTS_TABLE,
        Key: {
          studentID: username,
          name: key.toLowerCase()
        },
        ExpressionAttributeNames: {
          "#d": "detail"
        },
        ExpressionAttributeValues: {
          ":d": detail[key]
        },
        UpdateExpression: "set #d = :d"
      };
      await dynamoDbClient.update(params).promise();
    }
  }
}

async function addDetail({ studentID, detail }) {
  for (var key in detail) {
    const params = {
      TableName: STUDENTS_TABLE,
      Item: {
        studentID,
        name: key.toLowerCase(),
        detail: detail[key]
      }
    }
    await dynamoDbClient.put(params).promise();
  }
}

async function getUsers() {
  const users = []

  var params = {
    UserPoolId: USERPOOL_ID, /* required */
  };

  const data = await cognitoidentityserviceprovider.listGroups(params).promise();
  await Promise.all(data.Groups.map(async (groupEntity) => {
    var params = {
      GroupName: groupEntity.GroupName,
      UserPoolId: USERPOOL_ID, /* required */
    };
    await cognitoidentityserviceprovider.listUsersInGroup(params).promise().then((data1) => {
      data1.Users.map(userEntity => {
        users.push({
          username: userEntity.Username,
          email: userEntity.Attributes.filter((element) => element.Name === 'email')[0]["Value"],
          group: groupEntity.GroupName
        });
      });
    });
  }))
  return users;
}

async function getUser({ username, group }) {
  var output = {}
  var params = {
    UserPoolId: USERPOOL_ID, /* required */
    Username: username /* required */
  };
  const User = await cognitoidentityserviceprovider.adminGetUser(params).promise()
  output = {
    username: User.Username,
    email: User.UserAttributes.filter((element) => element.Name === 'email')[0]["Value"],
    group
  }
  if (group !== "student") {
    return output
  }
  output["studentDetail"] = {
    department_no: User.UserAttributes.filter((element) => element.Name === 'custom:departmentNo')[0]["Value"],
    class_no: User.UserAttributes.filter((element) => element.Name === 'custom:classNo')[0]["Value"]
  }
  var params = {
    TableName: STUDENTS_TABLE,
    ExpressionAttributeNames: {
      "#k": "studentID"
    },
    ExpressionAttributeValues: {
      ":k": username
    },
    KeyConditionExpression: "#k = :k"
  };
  const { Items } = await dynamoDbClient.query(params).promise();
  if (Items) {
    var details = []
    Items.forEach(element => {
      var item = {}
      item[element.name] = element.detail
      details.push(item)
    });
    output["studentDetail"]["details"] = details
  }
  return output;
}


module.exports.handler = async (event) => {
  console.log("Received event {}", JSON.stringify(event, 3));
  switch (event.field) {
    case 'createUser':
      var input = event.arguments.input;
      var { username, email, group } = input;
      var studentDetail = input["studentDetail"] || { department_no: null, class_no: null }
      await createUser({
        username,
        email,
        group,
        departmentNO: studentDetail.department_no,
        classNo: studentDetail.class_no
      });
      return input;
    case 'updateStudent':
      var input = event.arguments.input;
      var departmentNo = input.department_no || null;
      var classNo = input.class_no || null;
      var username = input.username;
      var detail = input.details || null;
      await updateStudent({
        username,
        departmentNo,
        classNo,
        detail
      });
      return "success"
    case 'addDetail':
      var input = event.arguments;
      var { username, detail } = input;
      await addDetail({
        studentID: username,
        detail
      });
      return "success"
    case 'getUsers':
      var users = await getUsers();
      return users;
    case 'getUser':
      var input = event.arguments;
      var { username, group } = input;
      var user = await getUser({ username, group });
      return user;
    default:
      return "error"
  }
};