main.floors.TS47=
{
    "floorId": "TS47",
    "title": "千钧一发 7层",
    "name": "千钧一发 7层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "03.png",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 1000000,
    "defaultGround": 976,
    "bgm": "19.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "2,11": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,2": [
            "Stage Clear！\n\r[#66CCFF]计分方式：生命/1000万\r。\n得到了\r[yellow]${parseInt(status:hp/100000000)}\r分数。\n已累计了\r[lime]${item:greenKey}\r绿钥匙。",
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
                "value": "parseInt(status:hp/10000000)"
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
    [160,160,160,160,160,240027,240028,240029,160,160,160,160,160],
    [160,1009,160,1009,160,240035,240036,240037,160,1009,160,1009,160],
    [160,160,160,160,160,160,1103,160,160,160,160,160,160],
    [622, 15,160,160,636,160,160,160,638,160,160,622,621],
    [160,  0,622,1084,  0,621, 16,641,  0,160,  0, 16,622],
    [160,160,1076,160,160,1090,635,1085,622,1083, 47,  0,160],
    [160,  0, 22,160,640,  0,  4,  4,  4,  4,  4,1091,160],
    [160, 23,  0,160,  0,622,  4,587,619,641,1091,640,160],
    [160,1088,160,160,1084,160,  4,619,922,620,  4,  0,160],
    [160,638, 83,637,  0,1085, 83,641,620,587,  4,641,160],
    [160,1080,160,160,160,621,  4,  4,  4,  4,  4,1084,160],
    [160,  0, 88,160,638,  0,1076,635,  0,636,1084,638,160],
    [160,160,160,160,160,160,160,160,160,160,160,160,160]
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