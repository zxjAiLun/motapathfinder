main.floors.MT671=
{
    "floorId": "MT671",
    "title": "671 层",
    "name": "671 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 500000000000,
    "defaultGround": 340350,
    "bgm": "36.mp3",
    "weather": [
        "rain",
        2
    ],
    "firstArrive": [
        "一段剧情。"
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "4,12": [
            {
                "type": "choices",
                "text": "\t[绿色按钮,A985]如果觉得打不动的话，\n不妨来点补给再前进吧！\n又或者，如果你更喜欢绿钥匙……？",
                "choices": [
                    {
                        "text": "获得4把绿钥匙",
                        "color": [
                            75,
                            217,
                            63,
                            1
                        ],
                        "need": "flag:671f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:671f",
                                "operator": "+=",
                                "value": "1"
                            }
                        ]
                    },
                    {
                        "text": "获得2把绿钥匙、120兆基础攻击",
                        "color": [
                            118,
                            209,
                            125,
                            1
                        ],
                        "need": "flag:671f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "operator": "+=",
                                "value": "120e12"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:671f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "2"
                            }
                        ]
                    },
                    {
                        "text": "获得240兆基础攻击",
                        "color": [
                            167,
                            217,
                            167,
                            1
                        ],
                        "need": "flag:671f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "operator": "+=",
                                "value": "240e12"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:671f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "4"
                            }
                        ]
                    },
                    {
                        "text": "离去…",
                        "action": []
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "6,4": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,12": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [200,200,200,200,200,1500,  0,200,200,200,200,200,200],
    [200,200,200,200,200,200,200,200,200,400213,200,200,200],
    [200,200,400205,200,200,200,200,200,200,200,200,200,200],
    [200,200,200,200,200,200,200,200,200,200,200,200,200],
    [200,200,200,200,200,200, 88,  0,  0,200,200,200,1021],
    [1022,200,200,274,274,400172,  0,  0,  0,400173,274,274,965],
    [965,274,274,274,274,  0,  0,  0,274,274,274,274,1438],
    [1438,274,274,274,274,274,  0,  0,274,274,274,274, 84],
    [ 84,274,274,274,274,274,274,  0,274,274,274,274,1012],
    [1185, 84,274,274,274,274,274,  0,  0,400207,274,1012,1012],
    [274,1014, 84,274,274,274,902,  0,274,274, 84,1012,274],
    [274,274,1013, 84,  0,  0,  0,570,274,274,1014,274,274],
    [274,274,274,274,985,  0, 87,  0, 84,1013, 84,274,274]
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