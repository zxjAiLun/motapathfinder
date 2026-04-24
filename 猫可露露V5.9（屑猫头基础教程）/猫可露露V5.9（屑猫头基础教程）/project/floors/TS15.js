main.floors.TS15=
{
    "floorId": "TS15",
    "title": "血洛缘起 5层",
    "name": "血洛缘起 5层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": 300,
    "bgm": "2.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "6,0": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,11": [
            "Stage Clear！\n得到了\r[yellow]${status:hp}\r分数。\n已累计了\r[lime]${item:greenKey}\r绿钥匙。",
            {
                "type": "unloadEquip",
                "pos": 0
            },
            {
                "type": "insert",
                "name": "清空状态"
            },
            {
                "type": "setValue",
                "name": "status:exp",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "flag:allhp",
                "operator": "+=",
                "value": "status:hp"
            },
            {
                "type": "setValue",
                "name": "status:lv",
                "value": "flag:nowlevel"
            },
            {
                "type": "setValue",
                "name": "item:yellowKey",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:blueKey",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:redKey",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:pickaxe",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:centerFly",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:I893",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:I894",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:I895",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:I897",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "status:hp",
                "value": "flag:allhp"
            },
            {
                "type": "setValue",
                "name": "status:atk",
                "value": "flag:nowatk"
            },
            {
                "type": "setValue",
                "name": "status:def",
                "value": "flag:nowdef"
            },
            {
                "type": "setValue",
                "name": "status:mdef",
                "value": "flag:nowmdef"
            },
            {
                "type": "setValue",
                "name": "status:lv",
                "value": "flag:nowlevel"
            },
            {
                "type": "setValue",
                "name": "status:exp",
                "value": "flag:nowexp"
            },
            {
                "type": "changeFloor",
                "floorId": "JC19",
                "loc": [
                    6,
                    0
                ],
                "direction": "down"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [  3,  3,  3,  3,  3,  3, 88,  3,  3,  3,  3,  3,  3],
    [  3,  3,621,  3, 59,  3, 59,635,220,  3,619,584,  3],
    [  3,  3,226,  3,219,  3,218,  3, 59,  3,221,  3,  3],
    [  3, 60,  0,223, 59,  0, 34,  3,  0,226,572,  0,  3],
    [  3,  3,  3,  3,  3,  3,221,  3, 34,  3,  3,221,  3],
    [ 58,572, 58,  3,  0,220,572, 58,223,  3, 58,  0,  3],
    [  3,221,  3,217, 58,  0,  3,  3, 59,  3,  3,223,  3],
    [  3,572,  0, 31,  3, 59,  3,  3,  0,  3,576,  0,  3],
    [  3,220,  3,  3, 34,217,  0,572,223,  3,  3,229,  3],
    [  3,  0,  3,576,220,  4,226,  4,572, 32,229,619,  3],
    [  3,229,  3,  0,  4,584,  0, 60,  4,239,619,  3,  3],
    [  3,576,226, 59,  4,  0,225,  0,  4, 60,  3,  3,  3],
    [  3,  3, 60,  3,  4, 60,  0,584,  4,635,621,  3,  3]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}