main.floors.MT255=
{
    "floorId": "MT255",
    "title": "255 层",
    "name": "255 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "03.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 100000,
    "defaultGround": 919,
    "bgm": "16.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "2,5": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,12": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "5,8": [
            {
                "type": "setValue",
                "name": "flag:door_MT255_6_11",
                "operator": "+=",
                "value": "1"
            }
        ],
        "4,9": [
            {
                "type": "setValue",
                "name": "flag:door_MT255_6_11",
                "operator": "+=",
                "value": "1"
            }
        ],
        "5,10": [
            {
                "type": "setValue",
                "name": "flag:door_MT255_6_11",
                "operator": "+=",
                "value": "1"
            }
        ],
        "6,9": [
            {
                "type": "setValue",
                "name": "flag:door_MT255_6_11",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,8": [
            {
                "type": "setValue",
                "name": "flag:door_MT255_6_11",
                "operator": "+=",
                "value": "1"
            }
        ],
        "8,9": [
            {
                "type": "setValue",
                "name": "flag:door_MT255_6_11",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,10": [
            {
                "type": "setValue",
                "name": "flag:door_MT255_6_11",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {
        "6,7": [
            "\t[纳可]奇怪，追寻着那个女孩的踪迹过来，\n结果她突然就不见了。",
            "\t[纳娜米]可可快看，那边有好多人……！",
            "\t[女巫]那边的小丫头，你们是什么人？",
            "\t[纳娜米]啊，我们是路过的冒险者。\n误入这里，如果惊扰到各位，还请谅解。",
            "\t[猎兵]嘿，等等。\n这附近这么多的雪兽，\n都是你们引过来的？",
            "\t[纳可]那是个意外呀……雪兽太多了，\n我们只好一路闯过来，\n如果给你们造成了什么麻烦，很抱歉……",
            "\t[女巫]抱歉？\n你们把这片雪域搅得天翻地覆，\n岂是一句抱歉就能揭过的？",
            "\t[猎兵]没什么好说的，真要道歉，\n那就留在这里吧！\n杀！",
            "什么？\n两个小女孩对视一眼，都是一脸懵，\n有些搞不清楚对方的意思。",
            "\t[纳可]……诶诶？！\n怎么这样欺负人啊！",
            "\t[纳娜米]好家伙，看到我们的等阶要低一筹，\n所以完全不打算讲道理吗。\n那就没办法了。",
            {
                "type": "battle",
                "loc": [
                    6,
                    9
                ]
            },
            {
                "type": "battle",
                "loc": [
                    5,
                    8
                ]
            },
            {
                "type": "battle",
                "loc": [
                    7,
                    8
                ]
            },
            {
                "type": "battle",
                "loc": [
                    4,
                    9
                ]
            },
            {
                "type": "battle",
                "loc": [
                    8,
                    9
                ]
            },
            {
                "type": "battle",
                "loc": [
                    5,
                    10
                ]
            },
            {
                "type": "battle",
                "loc": [
                    7,
                    10
                ]
            },
            "\t[猎兵]可恶的小鬼，居然敢伤我，\n你们给我等着——",
            {
                "type": "openDoor",
                "loc": [
                    6,
                    11
                ]
            },
            "\t[纳可]一群奇奇怪怪的人，哼。\n（做鬼脸）",
            "\t[纳娜米]他们往那边方向去了。\n咦，那里竟然有一堆冰塑建筑群落，\n这片冰原上，还有部落？",
            "\t[纳可]那些家伙好像是去叫人了呢。\n姐姐，我现在特别想去把他们揍一顿，\n怎么办……",
            "\t[纳娜米]不提这个，这些建筑很有可能是线索，\n怎么说也要进去闯一闯。\n可可，我们走！"
        ]
    },
    "autoEvent": {
        "6,11": {
            "0": {
                "condition": "flag:door_MT255_6_11==7",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT255_6_11",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [ 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20,619, 20, 20, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20, 15, 20, 20, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20, 60, 20, 20, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20, 15, 20, 20, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 88,  0, 47, 47,  0, 15, 60, 15,619, 20, 20],
    [ 20, 20, 20, 20, 20, 20, 86, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20, 20, 20, 86, 20, 20, 20, 20, 20, 20],
    [ 20, 20,620,  0,  0,552,  0,552,  0,  0,620, 20, 20],
    [ 20, 20,  0,621,552,  0,554,  0,552,621,  0, 20, 20],
    [ 20, 20,620,  0,  0,552,  0,552,  0,  0,620, 20, 20],
    [ 20, 20, 20, 20, 20, 20, 85, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20, 20, 20, 87, 20, 20, 20, 20, 20, 20]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

],
    "weather": [
        "snow",
        2
    ]
}