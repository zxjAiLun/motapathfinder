main.floors.TSmax=
{
    "floorId": "TSmax",
    "title": "满天星 穹顶",
    "name": "满天星 穹顶",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "05.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 400000000,
    "defaultGround": 10008,
    "bgm": "26.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,0": {
            "trigger": "action",
            "enable": true,
            "noPass": null,
            "displayDamage": true,
            "opacity": 1,
            "filter": {
                "blur": 0,
                "hue": 0,
                "grayscale": 0,
                "invert": false,
                "shadow": 0
            },
            "data": [
                "Stage Clear！\n\r[#66CCFF]计分方式：击杀灵心者后剩余生命\r。\n得到了\r[yellow]${flag:starpoint}\r分数。\n已累计了\r[lime]${item:greenKey}\r绿钥匙。",
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
                    "value": "flag:starpoint"
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
        }
    },
    "changeFloor": {
        "6,12": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,6": [
            {
                "type": "animate",
                "name": "huifu"
            },
            {
                "type": "setBlock",
                "number": "I935",
                "loc": [
                    [
                        6,
                        4
                    ]
                ]
            },
            {
                "type": "setBlock",
                "number": "I735",
                "loc": [
                    [
                        4,
                        6
                    ]
                ]
            },
            {
                "type": "setBlock",
                "number": "I1146",
                "loc": [
                    [
                        8,
                        6
                    ]
                ]
            },
            {
                "type": "setBlock",
                "number": "I1147",
                "loc": [
                    [
                        6,
                        8
                    ]
                ]
            }
        ],
        "6,2": [
            {
                "type": "animate",
                "name": "huifu",
                "loc": [
                    6,
                    6
                ]
            },
            {
                "type": "setBlock",
                "number": "I1426",
                "loc": [
                    [
                        6,
                        6
                    ]
                ]
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [141616,141617,141617,141617,141618,141641,716,141642,141616,141617,141617,141617,141618],
    [141627,141628,141629,141630,141631,141649,1375,141650,141627,141628,141629,141630,141631],
    [181,181,181,181,1126,181,1355,181,1010,181,181,181,181],
    [181,181,181,181,1330,1016,  0,1020,1300,181,181,181,181],
    [181,181,1018,1291,181,181,1313,181,181,1278,621,181,181],
    [181,1013,143126,638,181, 58,  0, 33,181,639,143126,923,181],
    [735,  0,143134,  0,1228,  0,1240,  0,1112,  0,143134,  0,1009],
    [181,1271,  0,1254,181, 32,  0, 34,181,1265,  0,1304,181],
    [181,181,619,  0,181,181,1104,181,181,  0,638,181,181],
    [181,240147,240148,240149,  0, 27,2091, 28,  0,240099,240100,240101,181],
    [181,181,2091,1091, 27,2091, 34,2091, 28,1091,2091,181,181],
    [181,181,181,181,181, 31,2091, 32,181,181,181,181,181],
    [181,181,181,181,181,181, 88,181,181,181,181,181,181]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ 90,  0,  0, 90,  0,  0,  0,  0,  0, 90,  0,  0, 90],
    [  0, 90,  0,  0,  0,  0,  0,  0,  0,  0,  0, 90,  0],
    [ 90,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 90],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,240131,240132,240133,  0,  0,  0,  0,  0,240083,240084,240085,  0],
    [  0,240139,240140,240141,  0,  0,  0,  0,  0,240091,240092,240093,  0],
    [ 90,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 90],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0, 90,  0,  0,  0,  0,  0,  0,  0,  0,  0, 90,  0],
    [ 90,  0,  0, 90,  0,  0,  0,  0,  0, 90,  0,  0, 90]
],
    "bg2map": [

],
    "fg2map": [

]
}