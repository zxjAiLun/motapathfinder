main.floors.TS35=
{
    "floorId": "TS35",
    "title": "枢机网络 5层",
    "name": "枢机网络 5层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "02.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 2000,
    "defaultGround": 30060,
    "bgm": "11.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "11,11": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,3": [
            "Stage Clear！\n\r[#66CCFF]计分方式：生命/10000\r。\n得到了\r[yellow]${parseInt(status:hp/10000)}\r分数。\n已累计了\r[lime]${item:greenKey}\r绿钥匙。",
            {
                "type": "unloadEquip",
                "pos": 0
            },
            {
                "type": "unloadEquip",
                "pos": 1
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
                "value": "parseInt(status:hp/10000)"
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
                "name": "item:I929",
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
    [192296,192296,192296,192296,192297,192218,192219,192220,192302,192303,192303,192303,192303],
    [192304,192304,192304,192304,192305,192226,192227,192228,192310,192311,192311,192311,192311],
    [192312,192312,192312,192312,192312,192234,192235,192236,192312,192312,192312,192312,192312],
    [50032,50033,50034, 60, 60,  4,452,  4,619, 15, 16, 83, 21],
    [50040,50041,50036,50034, 82,  4,  0,  4, 82,918,918,918, 60],
    [50048,50049,50044,50042,572, 81, 23, 81,572,50032,50034, 60, 86],
    [50056,50057,50048,50050, 81,918,447,918, 81,50048,50043,50034,621],
    [50064,50065,50056,50058,572,918,620,918,572,50056,50040,50041,50034],
    [636,  0,50064,50066, 59,918,444,918, 59,50064,50048,50049,50050],
    [  0,635,  4,  4,918,918,619,918,918,  0,50056,50057,50058],
    [  4,  0,619,  4,918,918,445,918,918,918,50064,50065,50066],
    [  4,638,  0, 83,446, 60,  0,443,572,442, 59, 88,918],
    [  4,  4,  4,  4,918,918,918,918,918,918,918,918,918]
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