main.floors.MT507=
{
    "floorId": "MT507",
    "title": "507 层",
    "name": "507 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 2000000000,
    "defaultGround": 160922,
    "bgm": "29.mp3",
    "weather": [
        "sun",
        2
    ],
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "0,7": [
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
                        "need": "flag:507f<1",
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
                                "name": "flag:507f",
                                "operator": "+=",
                                "value": "1"
                            }
                        ]
                    },
                    {
                        "text": "获得2把绿钥匙、5京血量",
                        "color": [
                            118,
                            209,
                            125,
                            1
                        ],
                        "need": "flag:507f<1",
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
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "5e16"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:507f",
                                "operator": "+=",
                                "value": "1"
                            }
                        ]
                    },
                    {
                        "text": "获得10京血量",
                        "color": [
                            167,
                            217,
                            167,
                            1
                        ],
                        "need": "flag:507f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "10e16"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "4"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:507f",
                                "operator": "+=",
                                "value": "1"
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
        "11,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "3,1": {
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
    [186,186,186,186,186,186,186,186,186,186,186,186,186],
    [186,639,186, 87,186,1011,186,642,186,161483,1520,640,186],
    [186,1523,186,1513,186, 16,186,  0,1510, 47,  0,1511,186],
    [186,  0,640,  0,1509,  0,186,1512,186,  0,1513, 15,186],
    [186,638,  0, 21,186,639,1513,1010,186,1518,1010,1512,186],
    [186,186, 81,186,186,186,186,186,638, 81,186, 15,186],
    [186,  0,1509,186,  0,645,1510,186,639,1514, 21,1509,186],
    [985,645,  0, 21, 15,186,1009,186,186,642,186,640,186],
    [160914,160914,160914,160915,1512,186,1509, 83,  0,1510,1009,1509,186],
    [161184,161185,161186,160923,640,  0,1010,186,640,  0,186,641,186],
    [161192,161193,161194,160923,1510,186,186,186, 81,186,186, 81,186],
    [160930,160930,160930,160931, 22, 81,641,1511,1010,  0, 21, 88,186],
    [160946,160946,160946,160939,186,186,186,186,186,186,186,186,186]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [161176,161177,161178,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [

],
    "fg2map": [

]
}